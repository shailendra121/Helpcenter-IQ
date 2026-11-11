exports.up = (pgm) => {
  pgm.addColumn("analysis_runs", {
    claimed_at: { type: "timestamptz", notNull: false },
  });
  pgm.sql(
    `UPDATE analysis_runs SET claimed_at = started_at WHERE status = 'running' AND claimed_at IS NULL`,
  );
};

exports.down = (pgm) => {
  pgm.dropColumn("analysis_runs", "claimed_at");
};
