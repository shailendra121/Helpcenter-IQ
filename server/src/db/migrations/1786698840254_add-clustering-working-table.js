/**
 * Scalability follow-up for HCIQ-10's clustering (flagged in review —
 * the original O(n × k) in-memory comparison doesn't scale to real
 * ticket volumes).
 *
 * Adds a working table that persists cluster centroids incrementally
 * as tickets are processed, so nearest-cluster lookup can be done via
 * a single pgvector SQL query (using the ivfflat-style <=> distance
 * operator) instead of looping over every cluster in JS for every
 * ticket. This turns the per-ticket cost from O(k) in-memory
 * comparisons into a single indexed database query.
 *
 * sum_embedding + member_count let us maintain a running average
 * (centroid) incrementally without re-reading all member vectors on
 * every update.
 */

exports.up = (pgm) => {
  pgm.createTable("clustering_working_clusters", {
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

    // Current average of all member ticket embeddings — what the
    // nearest-neighbor SQL query compares against.
    centroid: { type: "vector(1536)", notNull: true },

    // Running sum of member embeddings (not the average) — lets us
    // recompute the centroid after adding a new member with simple
    // vector addition + a division, without re-fetching every member.
    sum_embedding: { type: "vector(1536)", notNull: true },

    member_count: { type: "integer", notNull: true, default: 1 },
    member_ticket_ids: { type: "integer[]", notNull: true },

    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("clustering_working_clusters", ["zendesk_account_id", "analysis_run_id"]);

  // ivfflat index for fast nearest-centroid lookup, same pattern as
  // guide_articles' embedding index from HCIQ-9.
  pgm.sql(`
    CREATE INDEX clustering_working_clusters_centroid_idx ON clustering_working_clusters
    USING ivfflat (centroid vector_cosine_ops)
    WITH (lists = 100);
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("clustering_working_clusters");
};