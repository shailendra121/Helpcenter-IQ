export interface DraftArticlePromptInput {
  topicLabel: string;
  gapType: "missing" | "weak" | "outdated";
  representativeTicketExcerpts: string[];
  existingArticleText?: string;
  hasExistingArticle: boolean;
  recommendationRationale: string;
}

/**
 * Builds the draft-article generation prompt.
 *
 * Per HCIQ-13 scope:
 * - missing gaps produce a brand-new draft
 * - weak/outdated gaps with an existing article revise that article
 * - weak/outdated gaps whose matched article has no usable body are
 *   explicitly identified as having an existing article with unavailable
 *   content, rather than incorrectly saying that no article exists.
 */
export function buildDraftArticlePrompt(
  input: DraftArticlePromptInput
): string {
  const excerptsBlock = input.representativeTicketExcerpts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  let revisionContext: string;

  if (input.gapType === "missing") {
    revisionContext =
      "This topic currently has no knowledge base article — write a brand-new draft from scratch.";
  } else if (input.hasExistingArticle && input.existingArticleText) {
    revisionContext = `This is a REVISION of an existing article, not a new one. Existing article content:
${input.existingArticleText}

Your draft should build on and improve this existing article, not ignore it.`;
  } else if (input.hasExistingArticle) {
    revisionContext = `A matching knowledge base article EXISTS for this topic, but its article body is empty or unavailable.

Do NOT describe this as a topic with no existing article. Use the representative customer questions and recommendation rationale to create an improved draft, and flag the missing article content in internalReviewerNotes so a human reviewer can verify the existing article before approval.`;
  } else {
    revisionContext =
      "No existing knowledge base article was matched for this topic — write a brand-new draft from scratch.";
  }

  return `You are a knowledge-base writer for a customer support team. Write a 
draft help-center article for the following topic, based on real customer 
questions.

Topic: ${input.topicLabel}
Why this needs attention: ${input.recommendationRationale}

Representative customer questions:
${excerptsBlock}

${revisionContext}

Respond with ONLY valid JSON, no other text, in exactly this shape:
{
  "suggestedTitle": "<clear, searchable article title>",
  "problemSummary": "<1-2 sentences describing the problem from the customer's perspective>",
  "stepByStepResolution": "<numbered steps a customer can follow, as a single string with \\n between steps>",
  "faq": [
    { "question": "<a likely follow-up question>", "answer": "<a concise answer>" }
  ],
  "relatedKeywords": ["<keyword1>", "<keyword2>", "<keyword3>"],
  "internalReviewerNotes": "<any caveats, uncertainties, or things a human reviewer should double-check before approving>"
}

Include 2-4 FAQ entries. Never invent policy details (refund amounts, 
timeframes, etc.) you cannot verify from the ticket context — flag such 
gaps in internalReviewerNotes instead of guessing.`;
}
