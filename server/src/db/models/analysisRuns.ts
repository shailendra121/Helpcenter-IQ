import { pool } from "../pool.js";

export const ANALYSIS_STAGES = [
  "ticket_ingestion",
  "guide_ingestion",
  "clustering",
  "classification",
  "recommendation",
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export type AnalysisRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface StageTimestamp {
  started_at?: string;
  completed_at?: string;
}

export type StageTimestamps = Partial<
  Record<AnalysisStage, StageTimestamp>
>;

export interface AnalysisRunRow {
  id: number;
  zendesk_account_id: number;
  window_days: number;
  status: AnalysisRunStatus;
  started_at: Date | null;
  completed_at: Date | null;
  ingestion_cursor: string | null;

  current_stage: AnalysisStage | null;
  error_stage: AnalysisStage | null;
  error_message: string | null;
  stage_timestamps: StageTimestamps;
}
export class ActiveRunExistsError extends Error {
  constructor(public readonly zendeskAccountId: number) {
    super(
      `An analysis run is already active for Zendesk account ${zendeskAccountId}`,
    );

    this.name = "ActiveRunExistsError";
  }
}
/**
 * Legacy HCIQ-8 helper.
 *
 * Creates an analysis run directly in the running state.
 * HCIQ-14 orchestration should use createQueuedRun() instead.
 */
export async function createAnalysisRun(
  zendeskAccountId: number,
  windowDays: number
): Promise<AnalysisRunRow> {
  const result = await pool.query<AnalysisRunRow>(
    `INSERT INTO analysis_runs (
      zendesk_account_id,
      window_days,
      status,
      started_at
    )
    VALUES ($1, $2, 'running', now())
    RETURNING *`,
    [zendeskAccountId, windowDays]
  );

  return result.rows[0];
}

/**
 * HCIQ-14
 *
 * Creates a new analysis run in the queued state.
 *
 * The database partial unique index prevents more than one
 * queued/running run for the same Zendesk account.
 */
export async function createQueuedRun(
  zendeskAccountId: number,
  windowDays: number
): Promise<AnalysisRunRow> {
  try {
    const result = await pool.query<AnalysisRunRow>(
      `INSERT INTO analysis_runs (
        zendesk_account_id,
        window_days,
        status
      )
      VALUES ($1, $2, 'queued')
      RETURNING *`,
      [zendeskAccountId, windowDays]
    );

    return result.rows[0];
  } catch (error: unknown) {
    // PostgreSQL unique-constraint violation.
    // This means the account already has a queued/running run.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new ActiveRunExistsError(zendeskAccountId);
    }

    throw error;
  }
}

/**
 * Returns the currently active run for an account, if one exists.
 */
export async function getActiveRunForAccount(
  zendeskAccountId: number
): Promise<AnalysisRunRow | null> {
  const result = await pool.query<AnalysisRunRow>(
    `SELECT *
     FROM analysis_runs
     WHERE zendesk_account_id = $1
       AND status IN ('queued', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [zendeskAccountId]
  );

  return result.rows[0] ?? null;
}

/**
 * Recovers runs left in the running state after a process restart.
 *
 * HCIQ-14 MVP uses a single in-process worker, so on startup all
 * running runs are assumed to belong to the stopped worker and are
 * safely re-queued for recovery.
 *
 * Multi-worker / multi-replica deployment is not supported by this
 * recovery strategy.
 */

export async function recoverInterruptedRuns(): Promise<number> {
  const result = await pool.query(
    `UPDATE analysis_runs
     SET
       status = 'queued',
       current_stage = NULL,
       error_stage = NULL,
       error_message = NULL
     WHERE status = 'running'
     RETURNING id`,
  );

  return result.rowCount ?? 0;
}

export async function claimNextQueuedRun(): Promise<AnalysisRunRow | null> {
  const result = await pool.query<AnalysisRunRow>(
    `WITH next_run AS (
       SELECT id
       FROM analysis_runs
       WHERE status = 'queued'
       ORDER BY id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE analysis_runs AS ar
     SET
       status = 'running',
       started_at = COALESCE(ar.started_at, now())
     FROM next_run
     WHERE ar.id = next_run.id
     RETURNING ar.*`,
  );

  return result.rows[0] ?? null;
}

/**
 * Marks the beginning of a pipeline stage.
 */
export async function startAnalysisStage(
  runId: number,
  stage: AnalysisStage
): Promise<void> {
  await pool.query(
    `UPDATE analysis_runs
     SET
       current_stage = $2,
       error_stage = NULL,
       error_message = NULL,
       stage_timestamps = jsonb_set(
         COALESCE(stage_timestamps, '{}'::jsonb),
         ARRAY[$2],
         COALESCE(stage_timestamps -> $2, '{}'::jsonb)
           || jsonb_build_object('started_at', now()),
         true
       )
     WHERE id = $1`,
    [runId, stage]
  );
}

/**
 * Marks a pipeline stage as completed.
 */
export async function completeAnalysisStage(
  runId: number,
  stage: AnalysisStage
): Promise<void> {
  await pool.query(
    `UPDATE analysis_runs
     SET
       stage_timestamps = jsonb_set(
         COALESCE(stage_timestamps, '{}'::jsonb),
         ARRAY[$2],
         COALESCE(stage_timestamps -> $2, '{}'::jsonb)
           || jsonb_build_object('completed_at', now()),
         true
       )
     WHERE id = $1`,
    [runId, stage]
  );
}
/**
 * Records a stage-level failure.
 *
 * The run remains resumable because the completed stage timestamps
 * are preserved.
 */
export async function failRunAtStage(
  runId: number,
  stage: AnalysisStage,
  error: unknown
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : String(error);

  await pool.query(
    `UPDATE analysis_runs
     SET
       status = 'failed',
       current_stage = $2,
       error_stage = $2,
       error_message = $3
     WHERE id = $1`,
    [runId, stage, errorMessage]
  );
}

/**
 * Re-queues a failed run for retry.
 *
 * Stage timestamps are intentionally preserved so the pipeline
 * can determine where to resume.
 */
export async function retryAnalysisRun(
  runId: number
): Promise<AnalysisRunRow | null> {
  const result = await pool.query<AnalysisRunRow>(
    `UPDATE analysis_runs
     SET
       status = 'queued',
       current_stage = NULL,
       error_stage = NULL,
       error_message = NULL,
       completed_at = NULL
     WHERE id = $1
       AND status = 'failed'
     RETURNING *`,
    [runId]
  );

  return result.rows[0] ?? null;
}

/**
 * Completes the entire analysis run.
 */
export async function completeAnalysisRun(
  runId: number
): Promise<void> {
  await pool.query(
    `UPDATE analysis_runs
     SET
       status = 'completed',
       current_stage = NULL,
       completed_at = now()
     WHERE id = $1`,
    [runId]
  );
}

/**
 * Legacy HCIQ-8 failure helper.
 *
 * Kept for compatibility with the existing ticket ingestion code.
 * HCIQ-14 stage orchestration should use failRunAtStage().
 */
export async function failAnalysisRun(
  runId: number
): Promise<void> {
  await pool.query(
    `UPDATE analysis_runs
     SET status = 'failed'
     WHERE id = $1`,
    [runId]
  );
}

/**
 * Updates Zendesk ticket-ingestion cursor.
 *
 * Kept for HCIQ-8 resume support.
 */
export async function updateAnalysisRunCursor(
  runId: number,
  cursor: string
): Promise<void> {
  await pool.query(
    `UPDATE analysis_runs
     SET ingestion_cursor = $1
     WHERE id = $2`,
    [cursor, runId]
  );
}

/**
 * Gets a complete analysis run record.
 */
export async function getAnalysisRun(
  runId: number
): Promise<AnalysisRunRow | null> {
  const result = await pool.query<AnalysisRunRow>(
    `SELECT *
     FROM analysis_runs
     WHERE id = $1`,
    [runId]
  );

  return result.rows[0] ?? null;
}
