import { pool } from "../pool.js";

export type GapClassification = "missing" | "weak" | "outdated" | "good_coverage";

export interface CreateKnowledgeGapInput {
  analysisRunId: number;
  zendeskAccountId: number;
  clusterId: number;
  topicSummary: string;
  classification: GapClassification;
  estimatedTicketVolume: number;
  priorityScore: number;
  relatedGuideArticleId: number | null;
  similarityScore: number | null;
  justification: string | null;
  topicEmbedding: number[];
}

/**
 * Persists one classified knowledge gap. Called once per topic cluster
 * from HCIQ-10, per HCIQ-11's classification pipeline.
 */
export async function createKnowledgeGap(input: CreateKnowledgeGapInput): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO knowledge_gaps
       (analysis_run_id, zendesk_account_id, cluster_id, topic_summary, classification,
        estimated_ticket_volume, priority_score, related_guide_article_id,
        similarity_score, justification, topic_embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.analysisRunId,
      input.zendeskAccountId,
      input.clusterId,
      input.topicSummary,
      input.classification,
      input.estimatedTicketVolume,
      input.priorityScore,
      input.relatedGuideArticleId,
      input.similarityScore,
      input.justification,
      `[${input.topicEmbedding.join(",")}]`,
    ]
  );
  return result.rows[0].id;
}

export interface KnowledgeGapRow {
  id: number;
  topic_summary: string;
  classification: GapClassification;
  estimated_ticket_volume: number;
  priority_score: string | null;
  related_guide_article_id: number | null;
  similarity_score: string | null;
  justification: string | null;
}

export async function getKnowledgeGapsForRun(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<KnowledgeGapRow[]> {
  const result = await pool.query<KnowledgeGapRow>(
    `SELECT id, topic_summary, classification, estimated_ticket_volume,
            priority_score, related_guide_article_id, similarity_score, justification
     FROM knowledge_gaps
     WHERE zendesk_account_id = $1 AND analysis_run_id = $2
     ORDER BY priority_score DESC NULLS LAST`,
    [zendeskAccountId, analysisRunId]
  );
  return result.rows;
}

export async function deleteGapsForRun(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<void> {
  await pool.query(
    `DELETE FROM knowledge_gaps WHERE zendesk_account_id = $1 AND analysis_run_id = $2`,
    [zendeskAccountId, analysisRunId]
  );
}