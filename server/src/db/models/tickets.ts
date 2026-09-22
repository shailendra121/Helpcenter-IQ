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
 * Upserts a ticket snapshot — idempotent within an analysis run.
 *
 * The same Zendesk ticket may appear in multiple analysis runs.
 * Each run keeps its own snapshot so later runs do not overwrite
 * evidence belonging to earlier completed runs.
 *
 * If the text used for embeddings changes (subject or description),
 * the existing embedding is invalidated so clustering will regenerate it.
 */
export async function upsertTicket(input: TicketInput): Promise<void> {
  await pool.query(
    `INSERT INTO tickets
       (
         zendesk_account_id,
         analysis_run_id,
         zendesk_ticket_id,
         subject,
         description,
         first_comment,
         status,
         tags,
         zendesk_created_at,
         copilot_topic,
         copilot_sentiment,
         copilot_intent
       )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (
       zendesk_account_id,
       analysis_run_id,
       zendesk_ticket_id
     ) DO UPDATE SET
       embedding = CASE
         WHEN tickets.subject IS DISTINCT FROM EXCLUDED.subject
           OR tickets.description IS DISTINCT FROM EXCLUDED.description
         THEN NULL
         ELSE tickets.embedding
       END,
       subject = EXCLUDED.subject,
       description = EXCLUDED.description,
       first_comment = EXCLUDED.first_comment,
       status = EXCLUDED.status,
       tags = EXCLUDED.tags,
       zendesk_created_at = EXCLUDED.zendesk_created_at,
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

export async function countTicketsForAccount(
  zendeskAccountId: number
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)
     FROM tickets
     WHERE zendesk_account_id = $1`,
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
 * Returns tickets for an account within an analysis run that do not yet
 * have an embedding.
 */
export async function getTicketsNeedingEmbedding(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<TicketForClustering[]> {
  const result = await pool.query<TicketForClustering>(
    `SELECT
       id,
       zendesk_ticket_id,
       subject,
       description,
       embedding
     FROM tickets
     WHERE zendesk_account_id = $1
       AND analysis_run_id = $2
       AND embedding IS NULL`,
    [zendeskAccountId, analysisRunId]
  );

  return result.rows;
}

/**
 * Returns all tickets for an account within an analysis run that
 * have an embedding.
 *
 * Ordered by id for deterministic clustering because the greedy
 * clustering algorithm is order-dependent.
 */
export async function getEmbeddedTicketsForRun(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<TicketForClustering[]> {
  const result = await pool.query<TicketForClustering>(
    `SELECT
       id,
       zendesk_ticket_id,
       subject,
       description,
       embedding
     FROM tickets
     WHERE zendesk_account_id = $1
       AND analysis_run_id = $2
       AND embedding IS NOT NULL
     ORDER BY id`,
    [zendeskAccountId, analysisRunId]
  );

  return result.rows;
}

export async function updateTicketEmbedding(
  ticketId: number,
  embedding: number[]
): Promise<void> {
  await pool.query(
    `UPDATE tickets
     SET embedding = $1
     WHERE id = $2`,
    [`[${embedding.join(",")}]`, ticketId]
  );
}

export async function getTicketsByIds(
  ticketIds: number[],
  zendeskAccountId: number
): Promise<
  Array<{
    id: number;
    subject: string | null;
    description: string | null;
  }>
> {
  if (ticketIds.length === 0) {
    return [];
  }

  const result = await pool.query<{
    id: number;
    subject: string | null;
    description: string | null;
  }>(
    `SELECT
       id,
       subject,
       description
     FROM tickets
     WHERE id = ANY($1)
       AND zendesk_account_id = $2`,
    [ticketIds, zendeskAccountId]
  );

  return result.rows;
}