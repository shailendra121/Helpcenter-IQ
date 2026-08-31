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
 * Creates a new draft article version. Per scope item #5 (regeneration
 * versioning), this INSERTs a new row rather than updating an existing
 * one — prior drafts for the same gap are preserved, with version
 * numbers incrementing.
 */
export async function createDraftArticle(input: CreateDraftArticleInput): Promise<number> {
  const versionResult = await pool.query<{ max_version: number | null }>(
    `SELECT MAX(version) AS max_version FROM draft_articles WHERE knowledge_gap_id = $1`,
    [input.knowledgeGapId]
  );
  const nextVersion = (versionResult.rows[0].max_version ?? 0) + 1;

  const result = await pool.query<{ id: number }>(
    `INSERT INTO draft_articles
       (knowledge_gap_id, zendesk_account_id, suggested_title, problem_summary,
        step_by_step_resolution, faq_json, related_keywords, internal_reviewer_notes,
        review_status, ai_model_used, version)
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
  return result.rows[0].id;
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
const ALLOWED_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft: ["in_review"],
  in_review: ["approved", "rejected", "draft"], // can be sent back for revision
  approved: [],
  rejected: ["draft"], // can be reworked
};

export async function transitionDraftStatus(
  draftId: number,
  newStatus: ReviewStatus
): Promise<void> {
  const current = await pool.query<{ review_status: ReviewStatus }>(
    `SELECT review_status FROM draft_articles WHERE id = $1`,
    [draftId]
  );
  if (current.rows.length === 0) {
    throw new Error(`No draft article found with id ${draftId}`);
  }

  const currentStatus = current.rows[0].review_status;
  if (!ALLOWED_TRANSITIONS[currentStatus].includes(newStatus)) {
    throw new InvalidStatusTransitionError(currentStatus, newStatus);
  }

  await pool.query(`UPDATE draft_articles SET review_status = $1 WHERE id = $2`, [
    newStatus,
    draftId,
  ]);
}

export interface DraftArticleRow {
  id: number;
  knowledge_gap_id: number;
  suggested_title: string;
  problem_summary: string | null;
  step_by_step_resolution: string | null;
  faq_json: { question: string; answer: string }[] | null;
  related_keywords: string[] | null;
  internal_reviewer_notes: string | null;
  review_status: ReviewStatus;
  version: number;
}

export async function getLatestDraftForGap(gapId: number): Promise<DraftArticleRow | null> {
  const result = await pool.query<DraftArticleRow>(
    `SELECT id, knowledge_gap_id, suggested_title, problem_summary, step_by_step_resolution,
            faq_json, related_keywords, internal_reviewer_notes, review_status, version
     FROM draft_articles
     WHERE knowledge_gap_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [gapId]
  );
  return result.rows[0] ?? null;
}