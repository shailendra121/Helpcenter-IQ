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
 * Ingests all Guide articles for a Zendesk account, generating
 * embeddings only for articles that are new or whose zendesk_updated_at
 * changed since the last ingest (HCIQ-9's incremental-refresh
 * requirement).
 *
 * Draft articles are stored as metadata only and do not receive
 * embeddings because they are not published knowledge coverage yet.
 *
 * Per ADR-0003 (non-negotiable): article text is masked via maskPII()
 * before ever reaching embed() — same rule as HCIQ-5's ticket pipeline.
 *
 * AI calls use the centralized withRetry() wrapper so Gemini transient
 * rate-limit / 503 errors and global throttling are applied consistently.
 */
export async function ingestGuideArticles(
  zendeskAccountId: number,
  subdomain: string,
  lookbackDays = 3650,
): Promise<{
  articlesSeen: number;
  articlesEmbedded: number;
  articlesSkipped: number;
}> {
  const provider = createAIProvider();

  let startTime = toUnixSeconds(
    new Date(
      Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
    ),
  );

  let articlesSeen = 0;
  let articlesEmbedded = 0;
  let articlesSkipped = 0;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await fetchArticlePage(subdomain, startTime);

    for (const article of page.articles) {
      articlesSeen++;

      const result = await processArticle(
        zendeskAccountId,
        article,
        provider,
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
  provider: ReturnType<typeof createAIProvider>,
): Promise<"embedded" | "skipped"> {
  const cleanText = cleanArticleBody(article.body);
  const updatedAt = new Date(article.updated_at);

  // Check the OLD stored value BEFORE upserting — otherwise upsert
  // overwrites zendesk_updated_at first, making every article look
  // "unchanged" against its own freshly-written value.
  const storedUpdatedAt = await getStoredArticleUpdatedAt(
    zendeskAccountId,
    article.id,
  );

  await upsertArticleMetadata({
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

  if (article.draft) {
    return "skipped";
  }

  // Guard against empty body — an article with no extractable text
  // would otherwise send an empty string to embed(), which Gemini rejects.
  if (!cleanText.trim()) {
    return "skipped";
  }

  if (
    storedUpdatedAt &&
    storedUpdatedAt.getTime() === updatedAt.getTime()
  ) {
    return "skipped";
  }

  const { maskedText } = maskPII(cleanText);

  const { vector } = await withRetry(() =>
    provider.embed({ text: maskedText }),
  );

  await updateArticleEmbedding(
    zendeskAccountId,
    article.id,
    vector,
  );

  return "embedded";
}