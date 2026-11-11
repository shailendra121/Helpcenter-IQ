exports.up = (pgm) => {
  pgm.addColumn("analysis_runs", {
    claimed_at: { type: "timestamptz", notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("analysis_runs", "claimed_at");
};