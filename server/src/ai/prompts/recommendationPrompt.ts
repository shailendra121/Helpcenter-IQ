export interface RecommendationPromptInput {
  topicLabel: string;
  classification: "missing" | "weak" | "outdated";
  classificationJustification: string | null;
  representativeTicketExcerpts: string[]; // already masked by caller
  matchedArticleTitle: string | null;
  matchedArticleText: string | null; // already masked by caller
}

const VALID_TYPES = [
  "create_new_article",
  "update_existing_article",
  "add_missing_steps",
  "add_screenshots_examples",
  "improve_title",
  "add_keywords",
] as const;

/**
 * Builds the recommendation-generation prompt. Per HCIQ-12 scope: uses
 * topic label, masked representative ticket excerpts, matched article
 * (if any), and the classification justification from HCIQ-11 as
 * context. Requests strict JSON so the response can be validated, not
 * just pattern-matched like HCIQ-10's label generation.
 */
export function buildRecommendationPrompt(input: RecommendationPromptInput): string {
  const articleContext = input.matchedArticleTitle
    ? `Existing article: "${input.matchedArticleTitle}"\nArticle content: ${input.matchedArticleText}`
    : "No existing article covers this topic.";

  const excerptsBlock = input.representativeTicketExcerpts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  return `You are a knowledge-base editor for a customer support team. A topic 
cluster of tickets has been classified as "${input.classification}" coverage.

Topic: ${input.topicLabel}
Why this was classified as ${input.classification}: ${input.classificationJustification ?? "N/A"}

Representative customer questions:
${excerptsBlock}

${articleContext}

Suggest ONE actionable recommendation to improve knowledge base coverage 
for this topic. Choose exactly one type from this list: ${VALID_TYPES.join(", ")}.

Respond with ONLY valid JSON, no other text, in exactly this shape:
{
  "type": "<one of the allowed types>",
  "rationale": "<one or two sentences explaining why this recommendation>",
  "suggestedKeywords": ["<keyword1>", "<keyword2>", "<keyword3>"],
  "suggestedTitle": "<a title, or null if not applicable>"
}`;
}

export const RECOMMENDATION_TYPES = VALID_TYPES;