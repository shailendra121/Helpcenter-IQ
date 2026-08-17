/**
 * Review fix (HCIQ-10): removes the ivfflat index on
 * clustering_working_clusters.centroid.
 *
 * ivfflat is an APPROXIMATE nearest-neighbor index — with the default
 * probe count, "closest cluster" from a query using this index isn't
 * guaranteed to actually be the closest one. That's an acceptable
 * tradeoff for guide_articles (potentially thousands of rows, needs
 * to scale), but wrong here: the number of clusters per run is always
 * small (tens, not thousands — these are topics, not raw tickets), so
 * an exact sequential scan on this table is already fast, and exact
 * correctness matters more than approximate speed for a clustering
 * decision that determines which tickets group together.
 */

exports.up = (pgm) => {
  pgm.dropIndex("clustering_working_clusters", "centroid", {
    name: "clustering_working_clusters_centroid_idx",
    ifExists: true,
  });
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE INDEX clustering_working_clusters_centroid_idx ON clustering_working_clusters
    USING ivfflat (centroid vector_cosine_ops)
    WITH (lists = 100);
  `);
};