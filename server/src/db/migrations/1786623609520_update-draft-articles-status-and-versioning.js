/**
 * HCIQ-13 — Aligns draft_articles with the story's status lifecycle
 * (draft → in_review → approved/rejected) and adds versioning for
 * regeneration.
 *
 * The init-schema check constraint used pending_review/approved/
 * rejected/published, which doesn't match this story's required states
 * and — critically — allows "published", which this story explicitly
 * forbids (no code path may publish to Zendesk Guide). Flagging this
 * schema correction for review.
 */

exports.up = (pgm) => {
  pgm.dropConstraint("draft_articles", "draft_articles_review_status_check", {
    ifExists: true,
  });

  pgm.sql(`ALTER TABLE draft_articles ALTER COLUMN review_status SET DEFAULT 'draft'`);

  pgm.addConstraint("draft_articles", "draft_articles_review_status_check", {
    check: "review_status IN ('draft', 'in_review', 'approved', 'rejected')",
  });

  // Regeneration versioning (scope item #5): keep prior drafts rather
  // than overwriting, so reviewers can see/prefer an earlier version.
  pgm.addColumn("draft_articles", {
    version: { type: "integer", notNull: true, default: 1 },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("draft_articles", "version");
  pgm.dropConstraint("draft_articles", "draft_articles_review_status_check");
  pgm.sql(`ALTER TABLE draft_articles ALTER COLUMN review_status SET DEFAULT 'pending_review'`);
  pgm.addConstraint("draft_articles", "draft_articles_review_status_check", {
    check: "review_status IN ('pending_review','approved','rejected','published')",
  });
};