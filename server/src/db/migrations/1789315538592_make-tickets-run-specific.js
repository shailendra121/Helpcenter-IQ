/**
 * Makes ticket snapshots run-specific.
 *
 * A Zendesk ticket can appear in multiple analysis runs.
 * Each run should keep its own ticket row so later runs do not
 * overwrite evidence belonging to earlier completed runs.
 */

exports.up = (pgm) => {
  pgm.dropConstraint(
    "tickets",
    "tickets_account_ticket_unique"
  );

  pgm.addConstraint(
    "tickets",
    "tickets_account_run_ticket_unique",
    {
      unique: [
        "zendesk_account_id",
        "analysis_run_id",
        "zendesk_ticket_id",
      ],
    }
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint(
    "tickets",
    "tickets_account_run_ticket_unique"
  );

  // Rolling back to the previous uniqueness rule requires collapsing
  // run-specific snapshots back to one row per Zendesk ticket.
  pgm.sql(`
    DELETE FROM tickets older
    USING tickets newer
    WHERE older.zendesk_account_id = newer.zendesk_account_id
      AND older.zendesk_ticket_id = newer.zendesk_ticket_id
      AND older.id < newer.id
  `);

  pgm.addConstraint(
    "tickets",
    "tickets_account_ticket_unique",
    {
      unique: [
        "zendesk_account_id",
        "zendesk_ticket_id",
      ],
    }
  );
};