import { pool } from "../pool.js";

export interface CreateRecommendationInput {
  zendeskAccountId: number;
  gapId: number;
  type: string;
  rationale: string;
  suggestedKeywords: string[];
  suggestedTitle: string | null;
}

export async function createRecommendation(input: CreateRecommendationInput): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO gap_recommendations
       (zendesk_account_id, gap_id, recommendation_type, rationale, suggested_keywords, suggested_title)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.zendeskAccountId,
      input.gapId,
      input.type,
      input.rationale,
      input.suggestedKeywords,
      input.suggestedTitle,
    ]
  );
  return result.rows[0].id;
}

/**
 * Deletes prior recommendations for a gap — regeneration replaces
 * previous recommendations, per HCIQ-12's scope item #3.
 */
export async function deleteRecommendationsForGap(gapId: number): Promise<void> {
  await pool.query(`DELETE FROM gap_recommendations WHERE gap_id = $1`, [gapId]);
}

export interface GapRecommendationRow {
  id: number;
  gap_id: number;
  recommendation_type: string;
  rationale: string;
  suggested_keywords: string[] | null;
  suggested_title: string | null;
}

export async function getRecommendationsForRun(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<GapRecommendationRow[]> {
  const result = await pool.query<GapRecommendationRow>(
    `SELECT gr.id, gr.gap_id, gr.recommendation_type, gr.rationale, gr.suggested_keywords, gr.suggested_title
     FROM gap_recommendations gr
     JOIN knowledge_gaps kg ON kg.id = gr.gap_id
     WHERE gr.zendesk_account_id = $1 AND kg.analysis_run_id = $2`,
    [zendeskAccountId, analysisRunId]
  );
  return result.rows;
}