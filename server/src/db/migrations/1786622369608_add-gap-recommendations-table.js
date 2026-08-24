/**
 * HCIQ-12 — Recommendation generation for non-Good knowledge gaps.
 *
 * Stores AI-generated, structured recommendations per gap. Regenerating
 * recommendations for a gap (within the same run) replaces prior ones —
 * enforced at the application layer (deleteRecommendationsForGap before
 * insert), not by a unique constraint, since multiple recommendations
 * per gap are valid (e.g. "add missing steps" + "add keywords").
 */

exports.up = (pgm) => {
  pgm.createTable("gap_recommendations", {
    id: "id",

    zendesk_account_id: {
      type: "integer",
      notNull: true,
      references: "zendesk_accounts",
      onDelete: "CASCADE",
    },

    gap_id: {
      type: "integer",
      notNull: true,
      references: "knowledge_gaps",
      onDelete: "CASCADE",
    },

    recommendation_type: {
      type: "text",
      notNull: true,
      check:
        "recommendation_type IN ('create_new_article', 'update_existing_article', 'add_missing_steps', 'add_screenshots_examples', 'improve_title', 'add_keywords')",
    },

    rationale: {
      type: "text",
      notNull: true,
    },

    suggested_keywords: {
      type: "text[]",
    },

    suggested_title: {
      type: "text",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("gap_recommendations", "zendesk_account_id");
  pgm.createIndex("gap_recommendations", "gap_id");
};

exports.down = (pgm) => {
  pgm.dropTable("gap_recommendations");
};