/**
 * HCIQ-16 — Draft Review workflow.
 *
 * Keeps AI-generated draft content unchanged and stores reviewer edits
 * separately so the UI can show AI Draft vs Edited Draft side-by-side.
 *
 * HCIQ-13 already provides:
 * - review_status: draft -> in_review -> approved/rejected
 * - version
 */

exports.up = (pgm) => {
  pgm.addColumns("draft_articles", {
    reviewer_suggested_title: {
      type: "text",
    },

    reviewer_problem_summary: {
      type: "text",
    },

    reviewer_step_by_step_resolution: {
      type: "text",
    },

    reviewer_faq_json: {
      type: "jsonb",
    },

    reviewer_related_keywords: {
      type: "text[]",
    },

    reviewer_internal_notes: {
      type: "text",
    },

    rejection_reason: {
      type: "text",
    },

    reviewer_edited_at: {
      type: "timestamptz",
    },

    status_updated_at: {
      type: "timestamptz",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("draft_articles", [
    "reviewer_suggested_title",
    "reviewer_problem_summary",
    "reviewer_step_by_step_resolution",
    "reviewer_faq_json",
    "reviewer_related_keywords",
    "reviewer_internal_notes",
    "rejection_reason",
    "reviewer_edited_at",
    "status_updated_at",
  ]);
};