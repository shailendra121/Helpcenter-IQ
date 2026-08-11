import { pool } from "../pool.js";

export interface TicketInput {
  zendeskAccountId: number;
  analysisRunId: number;
  zendeskTicketId: number;
  subject: string | null;
  description: string | null;
  firstComment: string | null;
  status: string | null;
  tags: string[];
  zendeskCreatedAt: Date | null;
  copilotTopic: string | null;
  copilotSentiment: string | null;
  copilotIntent: string | null;
}

/**
 * Upserts a ticket ΓÇö idempotent per (zendesk_account_id, zendesk_ticket_id).
 * Re-ingesting the same window updates existing rows rather than
 * creating duplicates, satisfying HCIQ-8's idempotency requirement.
 */
export async function upsertTicket(input: TicketInput): Promise<void> {
  await pool.query(
    `INSERT INTO tickets
       (zendesk_account_id, analysis_run_id, zendesk_ticket_id, subject, description,
        first_comment, status, tags, zendesk_created_at, copilot_topic, copilot_sentiment, copilot_intent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (zendesk_account_id, zendesk_ticket_id) DO UPDATE SET
       analysis_run_id = EXCLUDED.analysis_run_id,
       subject = EXCLUDED.subject,
       description = EXCLUDED.description,
       first_comment = EXCLUDED.first_comment,
       status = EXCLUDED.status,
       tags = EXCLUDED.tags,
       copilot_topic = EXCLUDED.copilot_topic,
       copilot_sentiment = EXCLUDED.copilot_sentiment,
       copilot_intent = EXCLUDED.copilot_intent`,
    [
      input.zendeskAccountId,
      input.analysisRunId,
      input.zendeskTicketId,
      input.subject,
      input.description,
      input.firstComment,
      input.status,
      input.tags,
      input.zendeskCreatedAt,
      input.copilotTopic,
      input.copilotSentiment,
      input.copilotIntent,
    ]
  );
}

export async function countTicketsForAccount(zendeskAccountId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM tickets WHERE zendesk_account_id = $1`,
    [zendeskAccountId]
  );
  return parseInt(result.rows[0].count, 10);
}

export interface TicketForClustering {
  id: number;
  zendesk_ticket_id: string;
  subject: string | null;
  description: string | null;
  embedding: string | null;
}

/**
 * Returns tickets for an account within an analysis run that don't yet
 * have an embedding — used by the clustering pipeline (HCIQ-10) to
 * avoid re-embedding tickets that were already processed in a prior run.
 */
export async function getTicketsNeedingEmbedding(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<TicketForClustering[]> {
  const result = await pool.query<TicketForClustering>(
    `SELECT id, zendesk_ticket_id, subject, description, embedding
     FROM tickets
     WHERE zendesk_account_id = $1 AND analysis_run_id = $2 AND embedding IS NULL`,
    [zendeskAccountId, analysisRunId]
  );
  return result.rows;
}

/**
 * Returns all tickets for an account within an analysis run that DO
 * have an embedding — used as input to the clustering step itself.
 */
export async function getEmbeddedTicketsForRun(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<TicketForClustering[]> {
  const result = await pool.query<TicketForClustering>(
    `SELECT id, zendesk_ticket_id, subject, description, embedding
     FROM tickets
     WHERE zendesk_account_id = $1 AND analysis_run_id = $2 AND embedding IS NOT NULL`,
    [zendeskAccountId, analysisRunId]
  );
  return result.rows;
}

export async function updateTicketEmbedding(ticketId: number, embedding: number[]): Promise<void> {
  await pool.query(`UPDATE tickets SET embedding = $1 WHERE id = $2`, [
    `[${embedding.join(",")}]`,
    ticketId,
  ]);
}

export async function getTicketsByIds(
  ticketIds: number[]
): Promise<Array<{ id: number; subject: string | null; description: string | null }>> {
  if (ticketIds.length === 0) return [];
  const result = await pool.query<{ id: number; subject: string | null; description: string | null }>(
    `SELECT id, subject, description FROM tickets WHERE id = ANY($1)`,
    [ticketIds]
  );
  return result.rows;
}