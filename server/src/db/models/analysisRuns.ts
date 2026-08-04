import { pool } from "../pool.js";

export interface AnalysisRunRow {
  id: number;
  zendesk_account_id: number;
  window_days: number;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  ingestion_cursor: string | null; // opaque cursor token from Zendesk's cursor-based export API
}

export async function createAnalysisRun(
  zendeskAccountId: number,
  windowDays: number
): Promise<AnalysisRunRow> {
  const result = await pool.query<AnalysisRunRow>(
    `INSERT INTO analysis_runs (zendesk_account_id, window_days, status, started_at)
     VALUES ($1, $2, 'running', now())
     RETURNING *`,
    [zendeskAccountId, windowDays]
  );
  return result.rows[0];
}

export async function updateAnalysisRunCursor(
  runId: number,
  cursor: string
): Promise<void> {
  await pool.query(`UPDATE analysis_runs SET ingestion_cursor = $1 WHERE id = $2`, [
    cursor,
    runId,
  ]);
}

export async function completeAnalysisRun(runId: number): Promise<void> {
  await pool.query(
    `UPDATE analysis_runs SET status = 'completed', completed_at = now() WHERE id = $1`,
    [runId]
  );
}

export async function failAnalysisRun(runId: number): Promise<void> {
  await pool.query(`UPDATE analysis_runs SET status = 'failed' WHERE id = $1`, [runId]);
}

export async function getAnalysisRun(runId: number): Promise<AnalysisRunRow | null> {
  const result = await pool.query<AnalysisRunRow>(
    `SELECT * FROM analysis_runs WHERE id = $1`,
    [runId]
  );
  return result.rows[0] ?? null;
}