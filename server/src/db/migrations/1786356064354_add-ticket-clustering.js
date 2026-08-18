/**
 * HCIQ-10 — Ticket clustering schema.
 *
 * Adds ticket embeddings and persists clustering results per analysis run.
 *
 * Embeddings are 1536-dimensional to match the Gemini embedding
 * configuration used by the AI provider.
 *
 * Cluster membership is kept in a separate table because the same
 * ticket can belong to different clusters across different analysis runs.
 */

exports.up = (pgm) => {
  // Store the embedding generated from the masked ticket text.
  pgm.addColumn("tickets", {
    embedding: { type: "vector(1536)" },
  });

  // Stores one topic cluster produced by an analysis run.
  pgm.createTable("ticket_clusters", {
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

    topic_label: {
      type: "text",
      notNull: true,
    },

    topic_summary: {
      type: "text",
    },

    ticket_count: {
      type: "integer",
      notNull: true,
      default: 0,
    },

    // Centroid of the ticket embeddings belonging to this cluster.
    centroid_embedding: {
      type: "vector(1536)",
    },

    // IDs of a small number of representative tickets.
    representative_ticket_ids: {
      type: "bigint[]",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("ticket_clusters", "zendesk_account_id");
  pgm.createIndex("ticket_clusters", "analysis_run_id");

  // Maps tickets to clusters for a particular analysis run.
  pgm.createTable("ticket_cluster_members", {
    id: "id",

    cluster_id: {
      type: "integer",
      notNull: true,
      references: "ticket_clusters",
      onDelete: "CASCADE",
    },

    ticket_id: {
      type: "integer",
      notNull: true,
      references: "tickets",
      onDelete: "CASCADE",
    },

    // Cosine distance/similarity value used when assigning the ticket.
    distance: {
      type: "numeric",
    },
  });

  pgm.addConstraint(
    "ticket_cluster_members",
    "ticket_cluster_members_unique",
    {
      unique: ["cluster_id", "ticket_id"],
    }
  );

  pgm.createIndex(
    "ticket_cluster_members",
    "cluster_id"
  );

  pgm.createIndex(
    "ticket_cluster_members",
    "ticket_id"
  );
};

exports.down = (pgm) => {
  pgm.dropTable("ticket_cluster_members");
  pgm.dropTable("ticket_clusters");
  pgm.dropColumn("tickets", "embedding");
};