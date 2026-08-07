/**
 * Adds the guide_articles table for HCIQ-9 Guide article ingestion +
 * embedding.
 *
 * Flagged per the established pattern (see HCIQ-8's tickets migration):
 * this is a schema addition, not part of the original ADR-0002 schema —
 * proposing it here for review rather than silently extending the init
 * migration.
 */

exports.up = (pgm) => {
  pgm.createTable("guide_articles", {
    id: "id",
    zendesk_account_id: {
      type: "integer",
      notNull: true,
      references: "zendesk_accounts",
      onDelete: "CASCADE",
    },
    zendesk_article_id: { type: "bigint", notNull: true },
    title: { type: "text" },
    clean_text: { type: "text" }, // HTML body converted to plain text, used for embedding
    section_id: { type: "bigint" },
    locale: { type: "text" },
    draft: { type: "boolean", notNull: true, default: false },
    zendesk_created_at: { type: "timestamptz" },
    zendesk_updated_at: { type: "timestamptz" }, // drives incremental refresh + staleness signal for HCIQ-11
    // Dimension must match the Gemini embedding model's output — see
    // GeminiProvider.ts EMBEDDING_DIMENSION, verified on HCIQ-6.
    embedding: { type: "vector(1536)" },
    embedded_at: { type: "timestamptz" }, // when the embedding was last (re)generated
    ingested_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Idempotency: re-ingesting must not duplicate an article already
  // pulled in for this account (same pattern as HCIQ-8's tickets table).
  pgm.addConstraint("guide_articles", "guide_articles_account_article_unique", {
    unique: ["zendesk_account_id", "zendesk_article_id"],
  });

  pgm.createIndex("guide_articles", "zendesk_account_id");
  // IVFFlat index for scalable similarity search — flagged by reviewer:
// without this, findNearestArticles() does a full table scan, fine for
// a 23-article trial but won't scale to a real help center. lists=100
// is a reasonable default for small-to-medium datasets; per pgvector
// docs, tune upward as row count grows (~rows/1000).
pgm.sql(`
  CREATE INDEX guide_articles_embedding_idx ON guide_articles
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
`);
};

exports.down = (pgm) => {
  pgm.dropTable("guide_articles");
};