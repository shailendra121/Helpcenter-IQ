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
 * Recommendation types that are appropriate for each gap classification.
 *
 * This is also enforced at runtime in generateRecommendation.ts.
 * Keeping the mapping here makes the expected model behavior explicit
 * in the prompt.
 */
const RECOMMENDATION_TYPES_BY_CLASSIFICATION = {
  missing: ["create_new_article"],
  weak: ["add_missing_steps", "update_existing_article"],
  outdated: ["update_existing_article"],
} as const;

export function buildRecommendationPrompt(
  input: RecommendationPromptInput
): string {
  const articleContext = input.matchedArticleTitle
    ? `Existing article: "${input.matchedArticleTitle}"\nArticle content: ${input.matchedArticleText}`
    : "No existing article covers this topic.";

  const excerptsBlock = input.representativeTicketExcerpts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const allowedTypes =
    RECOMMENDATION_TYPES_BY_CLASSIFICATION[input.classification];

  return `You are a knowledge-base editor for a customer support team. A topic 
cluster of tickets has been classified as "${input.classification}" coverage.

Topic: ${input.topicLabel}
Why this was classified as ${input.classification}: ${input.classificationJustification ?? "N/A"}

Representative customer questions:
${excerptsBlock}

${articleContext}

Suggest ONE actionable recommendation to improve knowledge base coverage 
for this topic.

Because this gap is classified as "${input.classification}", choose exactly 
ONE recommendation type from these allowed types:

${allowedTypes.join(", ")}

Do not choose a recommendation type outside this classification-specific list.

For reference, the complete set of recommendation types is:
${VALID_TYPES.join(", ")}

Respond with ONLY valid JSON, no other text, in exactly this shape:
{
  "type": "<one of the allowed types for this classification>",
  "rationale": "<one or two sentences explaining why this recommendation>",
  "suggestedKeywords": ["<keyword1>", "<keyword2>", "<keyword3>"],
  "suggestedTitle": "<a title, or null if not applicable>"
}`;
}

export const RECOMMENDATION_TYPES = VALID_TYPES;