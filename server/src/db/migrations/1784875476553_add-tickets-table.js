/**
 * Adds the tickets table for HCIQ-8 ticket ingestion, and a cursor
 * column on analysis_runs for resumable pagination.
 *
 * Flagged per HCIQ-8's technical approach: this is a schema addition,
 * not part of the original ADR-0002 schema — proposing it here for
 * review rather than silently extending the init migration.
 */

exports.up = (pgm) => {
  pgm.createTable("tickets", {
    id: "id",
    zendesk_account_id: {
      type: "integer",
      notNull: true,
      references: "zendesk_accounts",
      onDelete: "CASCADE",
    },
    analysis_run_id: {
      type: "integer",
      notNull: true,
      references: "analysis_runs",
      onDelete: "CASCADE",
    },
    zendesk_ticket_id: { type: "bigint", notNull: true },
    subject: { type: "text" },
    description: { type: "text" },
    first_comment: { type: "text" },
    status: { type: "text" },
    tags: { type: "text[]" },
    zendesk_created_at: { type: "timestamptz" },
    copilot_topic: { type: "text" },
    copilot_sentiment: { type: "text" },
    copilot_intent: { type: "text" },
    ingested_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("tickets", "tickets_account_ticket_unique", {
    unique: ["zendesk_account_id", "zendesk_ticket_id"],
  });

  pgm.createIndex("tickets", "zendesk_account_id");
  pgm.createIndex("tickets", "analysis_run_id");

  pgm.addColumn("analysis_runs", {
    ingestion_cursor: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("analysis_runs", "ingestion_cursor");
  pgm.dropTable("tickets");
};