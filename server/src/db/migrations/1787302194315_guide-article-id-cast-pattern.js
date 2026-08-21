/**
 * Review fix (HCIQ-11) — the prior migration
 * (1786512255938_extend-knowledge-gaps.js) changed
 * related_guide_article_id from text to integer using
 * `USING NULL`, which discards any existing value rather than
 * attempting a cast. That migration already ran against a table with
 * no real data, so nothing was actually lost — but it's a destructive
 * pattern that would silently wipe data if repeated against a
 * populated column, flagged during review.
 *
 * This migration doesn't need to change the column's type again (it's
 * already integer) — it exists to demonstrate and document the
 * correct pattern for anyone touching this column type in the future:
 * an explicit cast, not USING NULL. Re-applies the same type with a
 * real cast expression as a no-op-in-practice but correctly-patterned
 * statement, so the migration history itself reflects the right way
 * to do this.
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE knowledge_gaps
    ALTER COLUMN related_guide_article_id
    TYPE integer
    USING related_guide_article_id::integer
  `);
};

exports.down = (pgm) => {
  // No-op: the column was already integer before this migration ran,
  // and the down migration for the original type change
  // (1786512255938) already handles reverting to text.
};