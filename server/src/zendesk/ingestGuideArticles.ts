import {
  fetchArticlePage,
  cleanArticleBody,
  type FetchedArticle,
} from "./guideArticleFetcher.js";

import {
  upsertArticleMetadata,
  updateArticleEmbedding,
  getStoredArticleUpdatedAt,
} from "../db/models/guideArticles.js";

import { maskPII } from "../pii/maskPII.js";
import { createAIProvider } from "../ai/providers/index.js";
import { withRetry } from "../ai/withRetry.js";

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Ingests all Guide articles for a Zendesk account.
 *
 * Published articles are embedded when:
 * - they are new,
 * - their content changed, or
 * - metadata says they are unchanged but no valid embedding exists.
 *
 * Draft or empty articles do not contribute to knowledge coverage and
 * therefore do not retain embeddings.
 *
 * Article text is masked before being sent to the AI provider.
 */
export async function ingestGuideArticles(
  zendeskAccountId: number,
  subdomain: string,
  lookbackDays = 3650
): Promise<{
  articlesSeen: number;
  articlesEmbedded: number;
  articlesSkipped: number;
}> {
  const provider = createAIProvider();

  let startTime = toUnixSeconds(
    new Date(
      Date.now() - lookbackDays * 24 * 60 * 60 * 1000
    )
  );

  let articlesSeen = 0;
  let articlesEmbedded = 0;
  let articlesSkipped = 0;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await fetchArticlePage(
      subdomain,
      startTime
    );

    for (const article of page.articles) {
      articlesSeen++;

      const result = await processArticle(
        zendeskAccountId,
        article,
        provider
      );

      if (result === "embedded") {
        articlesEmbedded++;
      }

      if (result === "skipped") {
        articlesSkipped++;
      }
    }

    hasNextPage = page.next_page !== null;
    startTime = page.end_time;
  }

  return {
    articlesSeen,
    articlesEmbedded,
    articlesSkipped,
  };
}

async function processArticle(
  zendeskAccountId: number,
  article: FetchedArticle,
  provider: ReturnType<typeof createAIProvider>
): Promise<"embedded" | "skipped"> {
  const cleanText = cleanArticleBody(article.body);
  const updatedAt = new Date(article.updated_at);

  // Read the previously stored timestamp before updating metadata.
  const storedUpdatedAt = await getStoredArticleUpdatedAt(
    zendeskAccountId,
    article.id
  );

  const { hasEmbedding } = await upsertArticleMetadata({
    zendeskAccountId,
    zendeskArticleId: article.id,
    title: article.title,
    cleanText,
    sectionId: article.section_id,
    locale: article.locale,
    draft: article.draft,
    zendeskCreatedAt: article.created_at
      ? new Date(article.created_at)
      : null,
    zendeskUpdatedAt: updatedAt,
  });

  // Draft articles are not published knowledge coverage.
  // upsertArticleMetadata() also clears any stale embedding.
  if (article.draft) {
    return "skipped";
  }

  // Empty published articles cannot be embedded.
  // Any previous embedding has already been invalidated.
  if (!cleanText.trim()) {
    return "skipped";
  }

  // Skip only when the article is unchanged AND a valid embedding
  // still exists. If a prior embedding attempt failed, hasEmbedding
  // will be false and this run retries it.
  if (
    storedUpdatedAt &&
    storedUpdatedAt.getTime() === updatedAt.getTime() &&
    hasEmbedding
  ) {
    return "skipped";
  }

  const { maskedText } = maskPII(cleanText);

  const { vector } = await withRetry(() =>
    provider.embed({
      text: maskedText,
    })
  );

  await updateArticleEmbedding(
    zendeskAccountId,
    article.id,
    vector
  );

  return "embedded";
}