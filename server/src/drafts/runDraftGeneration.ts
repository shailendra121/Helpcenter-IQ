import { pool } from "../db/pool.js";
import { getTicketsByIds } from "../db/models/tickets.js";
import { createDraftArticle } from "../db/models/draftArticles.js";
import { generateDraftArticle } from "./generateDraftArticle.js";

const BATCH_SIZE = 5;

interface NonGoodGapRow {
  id: number;
  cluster_id: number;
  topic_summary: string;
  classification: "missing" | "weak" | "outdated";
  related_guide_article_id: number | null;
}

/**
 * Generates draft articles for every non-Good gap in an analysis run.
 *
 * Depends on HCIQ-12 because recommendations are used as generation
 * context. This function never publishes anything to Zendesk Guide.
 *
 * Regenerating a gap creates a new draft version rather than overwriting
 * an existing draft. Versioning is handled by createDraftArticle().
 */
export async function runDraftGeneration(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<{ draftsCreated: number }> {
  const gapsResult = await pool.query<NonGoodGapRow>(
    `SELECT id, cluster_id, topic_summary, classification, related_guide_article_id
     FROM knowledge_gaps
     WHERE zendesk_account_id = $1
       AND analysis_run_id = $2
       AND classification != 'good_coverage'`,
    [zendeskAccountId, analysisRunId]
  );

  const gaps = gapsResult.rows;

  let draftsCreated = 0;

  for (let i = 0; i < gaps.length; i += BATCH_SIZE) {
    const batch = gaps.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((gap) => processGapDraft(zendeskAccountId, gap))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        draftsCreated++;
      } else {
        console.error(
          "Failed to generate a draft for a gap:",
          result.reason
        );
      }
    }
  }

  return { draftsCreated };
}

async function processGapDraft(
  zendeskAccountId: number,
  gap: NonGoodGapRow
): Promise<void> {
  const clusterResult = await pool.query<{
    representative_ticket_ids: string[] | null;
  }>(
    `SELECT representative_ticket_ids
     FROM ticket_clusters
     WHERE id = $1`,
    [gap.cluster_id]
  );

  const representativeIds = (
    clusterResult.rows[0]?.representative_ticket_ids ?? []
  ).map(Number);

  const representativeTickets =
    await getTicketsByIds(representativeIds);

  const excerpts = representativeTickets.map(
    (ticket) =>
      `${ticket.subject ?? ""} — ${ticket.description ?? ""}`.trim()
  );

  /**
   * Keep article existence separate from article body availability.
   *
   * A weak/outdated gap may have a matched Guide article whose clean_text
   * is empty or unavailable. That does NOT mean the article does not exist.
   */
  const hasExistingArticle =
    gap.related_guide_article_id !== null;

  let existingArticleText: string | undefined;

  if (hasExistingArticle) {
    const articleResult = await pool.query<{
      clean_text: string | null;
    }>(
      `SELECT clean_text
       FROM guide_articles
       WHERE id = $1`,
      [gap.related_guide_article_id]
    );

    existingArticleText =
      articleResult.rows[0]?.clean_text ?? undefined;
  }

  const recommendationResult = await pool.query<{
    rationale: string;
  }>(
    `SELECT rationale
     FROM gap_recommendations
     WHERE gap_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [gap.id]
  );

  const recommendationRationale =
    recommendationResult.rows[0]?.rationale ?? "";

  const draft = await generateDraftArticle({
    representativeTicketExcerpts: excerpts,
    existingArticleText,
    hasExistingArticle,
    gapType: gap.classification,
    topicLabel: gap.topic_summary,
    recommendationRationale,
  });

  await createDraftArticle({
    knowledgeGapId: gap.id,
    zendeskAccountId,
    suggestedTitle: draft.suggestedTitle,
    problemSummary: draft.problemSummary,
    stepByStepResolution: draft.stepByStepResolution,
    faq: draft.faq,
    relatedKeywords: draft.relatedKeywords,
    internalReviewerNotes: draft.internalReviewerNotes,
    aiModelUsed: draft.model,
  });
}

