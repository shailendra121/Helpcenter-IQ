/**
 * HCIQ-11 — Extends knowledge_gaps for gap classification.
 *
 * The init-schema already has classification, topic_summary,
 * estimated_ticket_volume, priority_score, related_guide_article_id,
 * and topic_embedding. This adds what's still missing:
 * - justification: the LLM's one-paragraph explanation for non-Good
 *   classifications (dashboard/reviewers need the "why")
 * - similarity_score: how close the best-matching article was
 * - cluster_id: traces the gap back to its source ticket_clusters row
 *
 * Also fixes related_guide_article_id, which was created as `text` in
 * the init migration — should be an integer FK to guide_articles.id.
 * Flagging this type correction on the ticket for review.
 */

exports.up = (pgm) => {
  pgm.addColumn("knowledge_gaps", {
    justification: { type: "text" },
    similarity_score: { type: "numeric" },
    cluster_id: {
      type: "integer",
      references: "ticket_clusters",
      onDelete: "SET NULL",
    },
  });

  // Fix related_guide_article_id: was `text` in init-schema, should be
  // an integer FK to guide_articles.id.
  pgm.sql(`ALTER TABLE knowledge_gaps ALTER COLUMN related_guide_article_id DROP DEFAULT`);
  pgm.sql(`ALTER TABLE knowledge_gaps ALTER COLUMN related_guide_article_id TYPE integer USING NULL`);
  pgm.addConstraint("knowledge_gaps", "knowledge_gaps_related_guide_article_id_fkey", {
    foreignKeys: {
      columns: "related_guide_article_id",
      references: "guide_articles(id)",
      onDelete: "SET NULL",
    },
  });

  pgm.createIndex("knowledge_gaps", "cluster_id");
};

exports.down = (pgm) => {
  pgm.dropConstraint("knowledge_gaps", "knowledge_gaps_related_guide_article_id_fkey");
  pgm.sql(`ALTER TABLE knowledge_gaps ALTER COLUMN related_guide_article_id TYPE text USING NULL`);
  pgm.dropColumn("knowledge_gaps", ["justification", "similarity_score", "cluster_id"]);
};