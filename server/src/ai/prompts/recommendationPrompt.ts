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
 * Recommendation types that are valid for each gap classification.
 *
 * Runtime validation in generateRecommendation.ts enforces this same
 * mapping. The prompt intentionally exposes only the types allowed for
 * the current classification so the model is less likely to choose an
 * incompatible recommendation.
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
    ? `Existing article title: "${input.matchedArticleTitle}"

Existing article content:
${input.matchedArticleText ?? "(Article content unavailable)"}`
    : "No matched existing article is available.";

  const excerptsBlock =
    input.representativeTicketExcerpts.length > 0
      ? input.representativeTicketExcerpts
          .map((excerpt, index) => `${index + 1}. ${excerpt}`)
          .join("\n")
      : "(No representative ticket excerpts available.)";

  const allowedTypes =
    RECOMMENDATION_TYPES_BY_CLASSIFICATION[input.classification];

  const classificationRule =
    input.classification === "missing"
      ? `The classification is MISSING.
There is no adequate knowledge article for this topic.
You MUST use "create_new_article".`
      : input.classification === "weak"
        ? `The classification is WEAK.
An existing article has been matched, but its coverage is incomplete or inadequate.

You MUST improve the existing article.
Choose ONLY one of:
- "add_missing_steps"
- "update_existing_article"

IMPORTANT:
- Do NOT choose "create_new_article".
- Do NOT decide that the matched article is irrelevant.
- Do NOT change or re-evaluate the classification.
- Even if creating a new article seems better, you must work within the given "weak" classification.`
        : `The classification is OUTDATED.
The existing article needs refreshed or corrected information.

You MUST use "update_existing_article".

IMPORTANT:
- Do NOT choose "create_new_article".
- Do NOT choose "add_missing_steps".
- Do NOT change or re-evaluate the classification.`;

  return `You are a knowledge-base editor for a customer support team.

A ticket topic has already been classified by another stage of the system.

The classification is FINAL.
You are NOT responsible for classifying or re-classifying the gap.

Topic:
${input.topicLabel}

Classification:
${input.classification}

Classification justification:
${input.classificationJustification ?? "N/A"}

Representative customer questions:
${excerptsBlock}

${articleContext}

CLASSIFICATION RULES:

${classificationRule}

Your task is to suggest exactly ONE actionable recommendation.

Allowed recommendation type${
    allowedTypes.length === 1 ? "" : "s"
  } for this request:

${allowedTypes.map((type) => `- "${type}"`).join("\n")}

The value of the JSON "type" field MUST exactly match one of the allowed
types shown above.

Do not invent another recommendation type.
Do not use a recommendation type from another classification.
Do not re-evaluate the supplied classification.

Respond with ONLY valid JSON.
Do not include markdown.
Do not include code fences.
Do not include commentary before or after the JSON.

Use exactly this JSON structure:

{
  "type": "${allowedTypes[0]}",
  "rationale": "<one or two sentences explaining why this recommendation is appropriate>",
  "suggestedKeywords": ["<keyword1>", "<keyword2>", "<keyword3>"],
  "suggestedTitle": "<a suggested title, or null if not applicable>"
}`;
}

export const RECOMMENDATION_TYPES = VALID_TYPES;