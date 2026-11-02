exports.up = (pgm) => {
  pgm.addColumn("zendesk_accounts", {
    zaf_secret_encrypted: { type: "text", notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("zendesk_accounts", "zaf_secret_encrypted");
};