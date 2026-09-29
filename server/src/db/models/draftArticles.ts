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
 * Creates a new draft article version.
 *
 * Regeneration creates a new row rather than updating the previous draft.
 * Version calculation and insertion are protected by a transaction-level
 * PostgreSQL advisory lock keyed by knowledgeGapId.
 *
 * This prevents two concurrent generations for the same knowledge gap
 * from calculating the same next version number.
 */
export async function createDraftArticle(
  input: CreateDraftArticleInput
): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /**
     * Serialize draft creation for this specific knowledge gap.
     *
     * The first argument is a namespace so this advisory lock does not
     * accidentally collide with unrelated advisory locks elsewhere.
     *
     * Because this is a transaction-level lock, PostgreSQL automatically
     * releases it when COMMIT or ROLLBACK occurs.
     */
    await client.query(
      `SELECT pg_advisory_xact_lock($1, $2)`,
      [13, input.knowledgeGapId]
    );

    const versionResult = await client.query<{
      max_version: number | null;
    }>(
      `SELECT MAX(version) AS max_version
       FROM draft_articles
       WHERE knowledge_gap_id = $1`,
      [input.knowledgeGapId]
    );

    const nextVersion =
      (versionResult.rows[0].max_version ?? 0) + 1;

    const result = await client.query<{ id: number }>(
      `INSERT INTO draft_articles
         (knowledge_gap_id, zendesk_account_id, suggested_title, problem_summary,
          step_by_step_resolution, faq_json, related_keywords,
          internal_reviewer_notes, review_status, ai_model_used, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)
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
        nextVersion,
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
  const result = await pool.query<DraftArticleRow>(
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

  return result.rows[0] ?? null;
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

  // Immutable AI-generated version
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
  version: number;
  created_at: Date;
}
export interface DraftListRow {
  id: number;
  knowledge_gap_id: number;
  topic_summary: string;
  suggested_title: string;
  reviewer_suggested_title: string | null;
  review_status: ReviewStatus;
  version: number;
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
   d.version,
   d.created_at,
   d.reviewer_edited_at,
   d.status_updated_at
 FROM draft_articles d
 JOIN knowledge_gaps kg
   ON kg.id = d.knowledge_gap_id
 WHERE d.zendesk_account_id = $1
   AND d.version = (
     SELECT MAX(latest.version)
     FROM draft_articles latest
     WHERE latest.knowledge_gap_id = d.knowledge_gap_id
       AND latest.zendesk_account_id = d.zendesk_account_id
   )
 ORDER BY d.created_at DESC, d.id DESC`,
    [zendeskAccountId]
  );

  return result.rows;
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
       version,
       created_at
     FROM draft_articles
     WHERE id = $1
       AND zendesk_account_id = $2`,
    [draftId, zendeskAccountId]
  );

  return result.rows[0] ?? null;
}
export async function getDraftVersionsForGap(
  knowledgeGapId: number,
  zendeskAccountId: number
): Promise<DraftArticleRow[]> {
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
       version,
       created_at
     FROM draft_articles
     WHERE knowledge_gap_id = $1
       AND zendesk_account_id = $2
     ORDER BY version DESC`,
    [knowledgeGapId, zendeskAccountId]
  );

  return result.rows;
}

export async function getLatestDraftForGap(
  gapId: number
): Promise<DraftArticleRow | null> {
  const result = await pool.query<DraftArticleRow>(
    `SELECT id, knowledge_gap_id, suggested_title, problem_summary,
            step_by_step_resolution, faq_json, related_keywords,
            internal_reviewer_notes, review_status, version
     FROM draft_articles
     WHERE knowledge_gap_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [gapId]
  );

  return result.rows[0] ?? null;
}
