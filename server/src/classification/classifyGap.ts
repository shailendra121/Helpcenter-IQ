import { createAIProvider } from "../ai/providers/index.js";
import { maskPII } from "../pii/maskPII.js";
import { withRetry } from "../ai/withRetry.js";
import { pool } from "../db/pool.js";


export interface ArticleMatch {
  articleId: number;
  title: string | null;
  similarity: number;
}

/**
 * Finds the best-matching published Guide article for a topic's
 * centroid embedding, using pgvector cosine distance. Returns null if
 * no article scores above the similarity floor — this is the "Missing"
 * signal (scope item #2's first branch).
 */
export async function findBestMatchingArticle(
  zendeskAccountId: number,
  topicEmbedding: number[],
  similarityFloor: number
): Promise<ArticleMatch | null> {
  const result = await pool.query<{ id: number; title: string | null; distance: number }>(
    `SELECT id, title, embedding <=> $1 AS distance
     FROM guide_articles
     WHERE zendesk_account_id = $2 AND embedding IS NOT NULL AND draft = false
     ORDER BY distance ASC
     LIMIT 1`,
    [`[${topicEmbedding.join(",")}]`, zendeskAccountId]
  );

  if (result.rows.length === 0) return null;

  const { id, title, distance } = result.rows[0];
  const similarity = 1 - distance; // pgvector <=> returns cosine DISTANCE; similarity = 1 - distance

  if (similarity < similarityFloor) return null;

  return { articleId: id, title, similarity };
}

export interface StalenessCheckInput {
  articleUpdatedAt: Date;
  recentTicketCount: number;
}

/**
 * Determines if an article is "outdated" relative to recent ticket
 * volume on its topic — per scope item #2's third branch. Both
 * thresholds are config-driven (documented on the ticket, per the
 * pattern established in HCIQ-10).
 */
export function isArticleOutdated(input: StalenessCheckInput): boolean {
  const staleDays = Number(process.env.GAP_STALE_ARTICLE_DAYS ?? 180);
  const recentTicketThreshold = Number(process.env.GAP_STALE_RECENT_TICKETS ?? 3);

  const daysSinceUpdate =
    (Date.now() - input.articleUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceUpdate > staleDays && input.recentTicketCount >= recentTicketThreshold;
}

export interface WeaknessCheckInput {
  topicSummary: string;
  representativeTicketExcerpts: string[];
  articleTitle: string | null;
  articleText: string;
}

export interface WeaknessCheckResult {
  isWeak: boolean;
  justification: string;
}

/**
 * Uses the LLM to judge whether a matched article fully answers a
 * topic's representative questions — per scope item #2's second branch.
 * Masked inputs only, per ADR-0003.
 */
export async function checkArticleWeakness(
  input: WeaknessCheckInput
): Promise<WeaknessCheckResult> {
  const provider = createAIProvider();

  const rawPrompt = `A customer support knowledge base article is being evaluated against a 
topic of frequently asked customer questions.

Topic: ${input.topicSummary}

Representative customer questions/excerpts:
${input.representativeTicketExcerpts.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Existing article title: ${input.articleTitle ?? "(untitled)"}
Existing article content:
${input.articleText}

Does this article FULLY and CLEARLY answer these customer questions? 
Respond with EXACTLY two lines:
Verdict: <YES or NO>
Reason: <one sentence explaining why>`;

  const { maskedText } = maskPII(rawPrompt);
  const { text } = await withRetry(() => provider.generateText({ prompt: maskedText }));

  const verdictMatch = text.match(/Verdict:\s*(YES|NO)/i);
  const reasonMatch = text.match(/Reason:\s*(.+)/i);

  const isWeak = verdictMatch?.[1]?.toUpperCase() === "NO";

  return {
    isWeak,
    justification: reasonMatch?.[1]?.trim() ?? "Unable to determine article adequacy.",
  };
}

export type GapClassification = "missing" | "weak" | "outdated" | "good_coverage";

/**
 * Priority formula: volume × severity, per scope item #3.
 * Severity is derived from classification type — Missing is the most
 * severe (no coverage exists at all), Weak/Outdated are moderate
 * (coverage exists but needs work), Good Coverage scores lowest since
 * it needs no action. Documented on the ticket per the story's requirement.
 */
const SEVERITY_WEIGHTS: Record<GapClassification, number> = {
  missing: 3,
  weak: 2,
  outdated: 2,
  good_coverage: 0.5,
};

export function computePriorityScore(
  classification: GapClassification,
  ticketVolume: number
): number {
  return ticketVolume * SEVERITY_WEIGHTS[classification];
}

export interface ClassifyGapInput {
  zendeskAccountId: number;
  topicSummary: string;
  topicEmbedding: number[];
  ticketVolume: number;
  representativeTicketExcerpts: string[];
}

export interface ClassifyGapResult {
  classification: GapClassification;
  relatedGuideArticleId: number | null;
  similarityScore: number | null;
  priorityScore: number;
  justification: string | null;
}

/**
 * Full classification pipeline for a single topic cluster — the core
 * of HCIQ-11. Decides Missing / Weak / Outdated / Good Coverage per
 * the branches documented in the story's scope item #2.
 */
export async function classifyGap(input: ClassifyGapInput): Promise<ClassifyGapResult> {
  const similarityFloor = Number(process.env.GAP_SIMILARITY_FLOOR ?? 0.65);

  const match = await findBestMatchingArticle(
    input.zendeskAccountId,
    input.topicEmbedding,
    similarityFloor
  );

  if (!match) {
    const classification: GapClassification = "missing";
    return {
      classification,
      relatedGuideArticleId: null,
      similarityScore: null,
      priorityScore: computePriorityScore(classification, input.ticketVolume),
      justification: null,
    };
  }

  const articleTextResult = await pool.query<{ title: string | null; clean_text: string | null; zendesk_updated_at: Date | null }>(
    `SELECT title, clean_text, zendesk_updated_at FROM guide_articles WHERE id = $1`,
    [match.articleId]
  );
  const article = articleTextResult.rows[0];

  const weaknessResult = await checkArticleWeakness({
    topicSummary: input.topicSummary,
    representativeTicketExcerpts: input.representativeTicketExcerpts,
    articleTitle: article.title,
    articleText: article.clean_text ?? "",
  });

  if (weaknessResult.isWeak) {
    const classification: GapClassification = "weak";
    return {
      classification,
      relatedGuideArticleId: match.articleId,
      similarityScore: match.similarity,
      priorityScore: computePriorityScore(classification, input.ticketVolume),
      justification: weaknessResult.justification,
    };
  }

  if (article.zendesk_updated_at && isArticleOutdated({
    articleUpdatedAt: article.zendesk_updated_at,
    recentTicketCount: input.ticketVolume,
  })) {
    const classification: GapClassification = "outdated";
    return {
      classification,
      relatedGuideArticleId: match.articleId,
      similarityScore: match.similarity,
      priorityScore: computePriorityScore(classification, input.ticketVolume),
      justification: `Article last updated ${article.zendesk_updated_at.toISOString().split("T")[0]}, but ${input.ticketVolume} related tickets have come in recently.`,
    };
  }

  const classification: GapClassification = "good_coverage";
  return {
    classification,
    relatedGuideArticleId: match.articleId,
    similarityScore: match.similarity,
    priorityScore: computePriorityScore(classification, input.ticketVolume),
    justification: null,
  };
}