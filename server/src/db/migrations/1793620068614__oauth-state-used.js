exports.up = (pgm) => {
  pgm.createTable("oauth_state_used", {
    jti: { type: "text", primaryKey: true },
    used_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("oauth_state_used");
};