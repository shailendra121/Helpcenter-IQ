/**
 * Initial schema. See ADR-0002 — single Postgres + pgvector store.
 *
 * Every table carries `zendesk_account_id` for tenant isolation; no query
 * in server/src/db/models/ should omit it from a WHERE clause.
 */

exports.up = (pgm) => {
  pgm.createExtension("vector", { ifNotExists: true });

  pgm.createTable("zendesk_accounts", {
    id: "id",
    subdomain: { type: "text", notNull: true, unique: true },
    oauth_access_token_encrypted: { type: "text", notNull: true },
    oauth_refresh_token_encrypted: { type: "text" },
    oauth_scope: { type: "text" },
    oauth_expires_at: { type: "timestamptz" },
    installed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("analysis_runs", {
    id: "id",
    zendesk_account_id: {
      type: "integer",
      notNull: true,
      references: "zendesk_accounts",
      onDelete: "CASCADE",
    },
    window_days: { type: "integer", notNull: true },
    status: { type: "text", notNull: true, default: "pending" },
    started_at: { type: "timestamptz" },
    completed_at: { type: "timestamptz" },
  });

  pgm.createTable("knowledge_gaps", {
    id: "id",
    analysis_run_id: {
      type: "integer",
      notNull: true,
      references: "analysis_runs",
      onDelete: "CASCADE",
    },
    zendesk_account_id: {
      type: "integer",
      notNull: true,
      references: "zendesk_accounts",
      onDelete: "CASCADE",
    },
    topic_summary: { type: "text", notNull: true },
    classification: {
      type: "text",
      notNull: true,
      check: "classification IN ('missing','weak','outdated','good_coverage')",
    },
    estimated_ticket_volume: { type: "integer", notNull: true, default: 0 },
    priority_score: { type: "numeric" },
    related_guide_article_id: { type: "text" },
    topic_embedding: { type: "vector(1536)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("knowledge_gaps", "zendesk_account_id");

  pgm.createTable("draft_articles", {
    id: "id",
    knowledge_gap_id: {
      type: "integer",
      notNull: true,
      references: "knowledge_gaps",
      onDelete: "CASCADE",
    },
    zendesk_account_id: {
      type: "integer",
      notNull: true,
      references: "zendesk_accounts",
      onDelete: "CASCADE",
    },
    suggested_title: { type: "text", notNull: true },
    problem_summary: { type: "text" },
    step_by_step_resolution: { type: "text" },
    faq_json: { type: "jsonb" },
    related_keywords: { type: "text[]" },
    internal_reviewer_notes: { type: "text" },
    review_status: {
      type: "text",
      notNull: true,
      default: "pending_review",
      check: "review_status IN ('pending_review','approved','rejected','published')",
    },
    ai_model_used: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("draft_articles", "zendesk_account_id");

  pgm.createTable("audit_logs", {
    id: "id",
    zendesk_account_id: { type: "integer", references: "zendesk_accounts" },
    event_type: { type: "text", notNull: true },
    detail_json: { type: "jsonb" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("audit_logs");
  pgm.dropTable("draft_articles");
  pgm.dropTable("knowledge_gaps");
  pgm.dropTable("analysis_runs");
  pgm.dropTable("zendesk_accounts");
};
