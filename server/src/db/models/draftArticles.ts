import { pool } from "../pool.js";

export type ReviewStatus = "draft" | "in_review" | "approved" | "rejected";

export interface CreateDraftArticleInput {
  knowledgeGapId: number;
  zendeskAccountId: number;
  suggestedTitle: string;
  problemSummary: string;
  stepByStepResolution: string;
  faq: { question: string; answer: string }[];
  relatedKeywords: string[];
  internalReviewerNotes: string;
  aiModelUsed: string;
}

/**
 * Creates or refreshes the single draft article for a knowledge gap.
 *
 * Draft articles are not versioned. If a draft already exists for the
 * knowledge gap, regeneration updates that same draft instead of creating
 * another row.
 *
 * The transaction-level advisory lock prevents concurrent generation
 * requests from creating duplicate drafts for the same knowledge gap.
 */
export async function createDraftArticle(
  input: CreateDraftArticleInput
): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `SELECT pg_advisory_xact_lock($1, $2)`,
      [13, input.knowledgeGapId]
    );

const existing = await client.query<{
  id: number;
  review_status: ReviewStatus;
}>(
  `SELECT id, review_status
   FROM draft_articles
   WHERE knowledge_gap_id = $1
     AND zendesk_account_id = $2
   LIMIT 1
   FOR UPDATE`,
  [input.knowledgeGapId, input.zendeskAccountId]
);

    if (existing.rows.length > 0) {
      const draftId = existing.rows[0].id;
      if (existing.rows[0].review_status === "approved") {
        throw new ApprovedDraftModificationError();
}
      await client.query(
        `UPDATE draft_articles
         SET suggested_title = $1,
             problem_summary = $2,
             step_by_step_resolution = $3,
             faq_json = $4,
             related_keywords = $5,
             internal_reviewer_notes = $6,
                          ai_model_used = $7,
             review_status = 'draft',
             rejection_reason = NULL,
             reviewer_suggested_title = NULL,
             reviewer_problem_summary = NULL,
             reviewer_step_by_step_resolution = NULL,
             reviewer_faq_json = NULL,
             reviewer_related_keywords = NULL,
             reviewer_internal_notes = NULL,
             reviewer_edited_at = NULL,
             status_updated_at = NOW()
         WHERE id = $8
           AND zendesk_account_id = $9`,
        [
          input.suggestedTitle,
          input.problemSummary,
          input.stepByStepResolution,
          JSON.stringify(input.faq),
          input.relatedKeywords,
          input.internalReviewerNotes,
          input.aiModelUsed,
          draftId,
          input.zendeskAccountId,
        ]
      );

      await client.query("COMMIT");
      return draftId;
    }

    const result = await client.query<{ id: number }>(
      `INSERT INTO draft_articles
         (knowledge_gap_id, zendesk_account_id, suggested_title, problem_summary,
          step_by_step_resolution, faq_json, related_keywords,
          internal_reviewer_notes, review_status, ai_model_used, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, 1)
       RETURNING id`,
      [
        input.knowledgeGapId,
        input.zendeskAccountId,
        input.suggestedTitle,
        input.problemSummary,
        input.stepByStepResolution,
        JSON.stringify(input.faq),
        input.relatedKeywords,
        input.internalReviewerNotes,
        input.aiModelUsed,
      ]
    );

    await client.query("COMMIT");

    return result.rows[0].id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export class ApprovedDraftModificationError extends Error {
  constructor() {
    super("Approved drafts cannot be edited or regenerated.");
    this.name = "ApprovedDraftModificationError";
  }
}

export interface SaveReviewerEditsInput {
  suggestedTitle: string;
  problemSummary: string;
  stepByStepResolution: string;
  faq: {
    question: string;
    answer: string;
  }[];
  relatedKeywords: string[];
  internalReviewerNotes: string;
}
export class InvalidStatusTransitionError extends Error {
  constructor(from: ReviewStatus, to: ReviewStatus) {
    super(`Cannot transition draft article from "${from}" to "${to}"`);
    this.name = "InvalidStatusTransitionError";
  }
}

// Per acceptance criteria: status transitions are enforced — e.g. a
// draft cannot go straight to "approved" without passing through
// "in_review" first.
const ALLOWED_TRANSITIONS: Record<
  ReviewStatus,
  ReviewStatus[]
> = {
  draft: ["in_review"],
  in_review: ["approved", "rejected", "draft"],
  approved: [],
  rejected: ["draft"],
};
export async function saveReviewerEdits(
  draftId: number,
  zendeskAccountId: number,
  input: SaveReviewerEditsInput
): Promise<DraftArticleRow | null> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await client.query<{
      review_status: ReviewStatus;
    }>(
      `SELECT review_status
       FROM draft_articles
       WHERE id = $1
         AND zendesk_account_id = $2
       FOR UPDATE`,
      [draftId, zendeskAccountId]
    );

    if (current.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }

    if (current.rows[0].review_status === "approved") {
      throw new ApprovedDraftModificationError();
    }

    const result = await client.query<DraftArticleRow>(
      `UPDATE draft_articles
       SET reviewer_suggested_title = $1,
           reviewer_problem_summary = $2,
           reviewer_step_by_step_resolution = $3,
           reviewer_faq_json = $4,
           reviewer_related_keywords = $5,
           reviewer_internal_notes = $6,
           reviewer_edited_at = NOW()
       WHERE id = $7
         AND zendesk_account_id = $8
         AND review_status <> 'approved'
       RETURNING *`,
      [
        input.suggestedTitle,
        input.problemSummary,
        input.stepByStepResolution,
        JSON.stringify(input.faq),
        input.relatedKeywords,
        input.internalReviewerNotes,
        draftId,
        zendeskAccountId,
      ]
    );

    await client.query("COMMIT");

    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class RejectionReasonRequiredError extends Error {
  constructor() {
    super("A rejection reason is required when rejecting a draft article");
    this.name = "RejectionReasonRequiredError";
  }
}

export class DraftArticleNotFoundError extends Error {
  constructor(draftId: number) {
    super(`No draft article found with id ${draftId}`);
    this.name = "DraftArticleNotFoundError";
  }
}

export async function transitionDraftStatus(
  draftId: number,
  zendeskAccountId: number,
  newStatus: ReviewStatus,
  rejectionReason?: string
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await client.query<{
      review_status: ReviewStatus;
    }>(
      `SELECT review_status
       FROM draft_articles
       WHERE id = $1
         AND zendesk_account_id = $2
       FOR UPDATE`,
      [draftId, zendeskAccountId]
    );

    if (current.rows.length === 0) {
      throw new DraftArticleNotFoundError(draftId);
    }

    const currentStatus = current.rows[0].review_status;

    if (!ALLOWED_TRANSITIONS[currentStatus].includes(newStatus)) {
      throw new InvalidStatusTransitionError(
        currentStatus,
        newStatus
      );
    }

    const trimmedRejectionReason = rejectionReason?.trim();

    if (newStatus === "rejected" && !trimmedRejectionReason) {
      throw new RejectionReasonRequiredError();
    }

    await client.query(
      `UPDATE draft_articles
       SET review_status = $1,
           rejection_reason = $2,
           status_updated_at = NOW()
       WHERE id = $3
         AND zendesk_account_id = $4`,
      [
        newStatus,
        newStatus === "rejected"
          ? trimmedRejectionReason
          : null,
        draftId,
        zendeskAccountId,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface DraftArticleRow {
  id: number;
  knowledge_gap_id: number;
  zendesk_account_id: number;

  // AI-generated draft content
  suggested_title: string;
  problem_summary: string | null;
  step_by_step_resolution: string | null;
  faq_json: {
    question: string;
    answer: string;
  }[] | null;
  related_keywords: string[] | null;
  internal_reviewer_notes: string | null;

  // Human reviewer revision — never overwrite AI fields above
  reviewer_suggested_title: string | null;
  reviewer_problem_summary: string | null;
  reviewer_step_by_step_resolution: string | null;
  reviewer_faq_json: {
    question: string;
    answer: string;
  }[] | null;
  reviewer_related_keywords: string[] | null;
  reviewer_internal_notes: string | null;

  rejection_reason: string | null;
  reviewer_edited_at: Date | null;
  status_updated_at: Date | null;

  review_status: ReviewStatus;
  created_at: Date;
}
export interface DraftListRow {
  id: number;
  knowledge_gap_id: number;
  topic_summary: string;
  suggested_title: string;
  reviewer_suggested_title: string | null;
  review_status: ReviewStatus;
  created_at: Date;
  reviewer_edited_at: Date | null;
  status_updated_at: Date | null;
}
export async function listDraftArticles(
  zendeskAccountId: number
): Promise<DraftListRow[]> {
  const result = await pool.query<DraftListRow>(
    `SELECT
   d.id,
   d.knowledge_gap_id,
   kg.topic_summary,
   d.suggested_title,
   d.reviewer_suggested_title,
   d.review_status,
   d.created_at,
   d.reviewer_edited_at,
   d.status_updated_at
 FROM draft_articles d
 JOIN knowledge_gaps kg
   ON kg.id = d.knowledge_gap_id
 WHERE d.zendesk_account_id = $1
    ORDER BY d.created_at DESC, d.id DESC`,
    [zendeskAccountId]
  );

  return result.rows;
}
/**
 * Finds the single draft article for a knowledge gap within
 * the authenticated Zendesk account.
 */
export async function getDraftArticleForGap(
  knowledgeGapId: number,
  zendeskAccountId: number
): Promise<DraftArticleRow | null> {
  const result = await pool.query<DraftArticleRow>(
    `SELECT
       id,
       knowledge_gap_id,
       zendesk_account_id,
       suggested_title,
       problem_summary,
       step_by_step_resolution,
       faq_json,
       related_keywords,
       internal_reviewer_notes,
       reviewer_suggested_title,
       reviewer_problem_summary,
       reviewer_step_by_step_resolution,
       reviewer_faq_json,
       reviewer_related_keywords,
       reviewer_internal_notes,
       rejection_reason,
       reviewer_edited_at,
       status_updated_at,
       review_status,
       ai_model_used,
       created_at
     FROM draft_articles
     WHERE knowledge_gap_id = $1
       AND zendesk_account_id = $2
     LIMIT 1`,
    [knowledgeGapId, zendeskAccountId]
  );

  return result.rows[0] ?? null;
}

export async function getDraftArticleById(
  draftId: number,
  zendeskAccountId: number
): Promise<DraftArticleRow | null> {
  const result = await pool.query<DraftArticleRow>(
    `SELECT
       id,
       knowledge_gap_id,
       zendesk_account_id,

       suggested_title,
       problem_summary,
       step_by_step_resolution,
       faq_json,
       related_keywords,
       internal_reviewer_notes,

       reviewer_suggested_title,
       reviewer_problem_summary,
       reviewer_step_by_step_resolution,
       reviewer_faq_json,
       reviewer_related_keywords,
       reviewer_internal_notes,

       rejection_reason,
       reviewer_edited_at,
       status_updated_at,

       review_status,
       created_at
     FROM draft_articles
     WHERE id = $1
       AND zendesk_account_id = $2`,
    [draftId, zendeskAccountId]

  );

  return result.rows[0] ?? null;
}
