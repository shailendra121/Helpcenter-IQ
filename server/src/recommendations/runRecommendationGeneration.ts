import { pool } from "../db/pool.js";
import { getTicketsByIds } from "../db/models/tickets.js";
import {
  createRecommendation,
  deleteRecommendationsForGap,
} from "../db/models/gapRecommendations.js";
import { generateRecommendation } from "./generateRecommendation.js";
import type { RecommendationPromptInput } from "../ai/prompts/recommendationPrompt.js";

// Same bounded-concurrency pattern as HCIQ-11's runGapClassification —
// avoids firing hundreds of sequential LLM calls for accounts with many
// non-Good gaps.
const BATCH_SIZE = 5;

interface NonGoodGapRow {
  id: number;
  cluster_id: number;
  topic_summary: string;
  classification: "missing" | "weak" | "outdated";
  justification: string | null;
  related_guide_article_id: number | null;
}

/**
 * Generates recommendations for every non-Good gap in an analysis run.
 * Depends on HCIQ-11 (gaps must be classified). Idempotent — clears a
 * gap's prior recommendations before generating new ones, per scope
 * item #3 ("regeneration replaces prior recommendations").
 */
export async function runRecommendationGeneration(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<{ recommendationsCreated: number }> {
  const gapsResult = await pool.query<NonGoodGapRow>(
    `SELECT id, cluster_id, topic_summary, classification, justification, related_guide_article_id
     FROM knowledge_gaps
     WHERE zendesk_account_id = $1 AND analysis_run_id = $2 AND classification != 'good_coverage'`,
    [zendeskAccountId, analysisRunId]
  );
  const gaps = gapsResult.rows;

  let recommendationsCreated = 0;

  for (let i = 0; i < gaps.length; i += BATCH_SIZE) {
    const batch = gaps.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((gap) => processGap(zendeskAccountId, gap))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        recommendationsCreated++;
      } else {
        // Per-gap error isolation — one gap's malformed/failed
        // recommendation shouldn't abort the whole run.
        console.error("Failed to generate a recommendation for a gap:", result.reason);
      }
    }
  }

  return { recommendationsCreated };
}

async function processGap(zendeskAccountId: number, gap: NonGoodGapRow): Promise<void> {
  await deleteRecommendationsForGap(gap.id);

  // Representative tickets come from the gap's source cluster.
  const clusterResult = await pool.query<{ representative_ticket_ids: string[] | null }>(
    `SELECT representative_ticket_ids FROM ticket_clusters WHERE id = $1`,
    [gap.cluster_id]
  );
  const representativeIds = (clusterResult.rows[0]?.representative_ticket_ids ?? []).map(Number);
  const representativeTickets = await getTicketsByIds(representativeIds);
  const excerpts = representativeTickets.map(
    (t) => `${t.subject ?? ""} — ${t.description ?? ""}`.trim()
  );

  let matchedArticleTitle: string | null = null;
  let matchedArticleText: string | null = null;

  if (gap.related_guide_article_id) {
    const articleResult = await pool.query<{ title: string | null; clean_text: string | null }>(
      `SELECT title, clean_text FROM guide_articles WHERE id = $1`,
      [gap.related_guide_article_id]
    );
    matchedArticleTitle = articleResult.rows[0]?.title ?? null;
    matchedArticleText = articleResult.rows[0]?.clean_text ?? null;
  }

  const promptInput: RecommendationPromptInput = {
    topicLabel: gap.topic_summary,
    classification: gap.classification,
    classificationJustification: gap.justification,
    representativeTicketExcerpts: excerpts,
    matchedArticleTitle,
    matchedArticleText,
  };

  const recommendation = await generateRecommendation(promptInput);

  await createRecommendation({
    zendeskAccountId,
    gapId: gap.id,
    type: recommendation.type,
    rationale: recommendation.rationale,
    suggestedKeywords: recommendation.suggestedKeywords,
    suggestedTitle: recommendation.suggestedTitle,
  });
}