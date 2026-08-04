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