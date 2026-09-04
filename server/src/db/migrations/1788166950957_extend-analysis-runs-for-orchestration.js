/**
 * HCIQ-14 — Extends analysis_runs for pipeline orchestration.
 *
 * Adds stage tracking, failure information, and per-stage timestamps
 * for the background five-stage analysis pipeline.
 *
 * Lifecycle:
 *   queued -> running -> completed
 *                    -> failed
 */

exports.up = (pgm) => {
  pgm.addColumn("analysis_runs", {
    current_stage: { type: "text" },
    error_stage: { type: "text" },
    error_message: { type: "text" },
    stage_timestamps: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
  });

  pgm.sql(`
  UPDATE analysis_runs
  SET status = 'queued'
  WHERE status = 'pending'
`);

  pgm.sql(`
    ALTER TABLE analysis_runs
    ALTER COLUMN status SET DEFAULT 'queued'
  `);

  pgm.addConstraint("analysis_runs", "analysis_runs_status_check", {
    check: "status IN ('queued', 'running', 'completed', 'failed')",
  });

  pgm.createIndex("analysis_runs", ["zendesk_account_id", "status"]);

  // Only one queued/running run may exist for an account at a time.
  pgm.createIndex("analysis_runs", "zendesk_account_id", {
    name: "analysis_runs_one_active_per_account",
    unique: true,
    where: "status IN ('queued', 'running')",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex(
    "analysis_runs",
    "analysis_runs_one_active_per_account"
  );

  pgm.dropIndex("analysis_runs", ["zendesk_account_id", "status"]);

  pgm.dropConstraint(
    "analysis_runs",
    "analysis_runs_status_check"
  );

  pgm.sql(`
    ALTER TABLE analysis_runs
    ALTER COLUMN status SET DEFAULT 'pending'
  `);

  pgm.dropColumn("analysis_runs", [
    "current_stage",
    "error_stage",
    "error_message",
    "stage_timestamps",
  ]);
};