export interface DraftArticlePromptInput {
  topicLabel: string;
  gapType: "missing" | "weak" | "outdated";
  representativeTicketExcerpts: string[]; // already masked
  existingArticleText?: string; // already masked, present for weak/outdated
  recommendationRationale: string;
}

/**
 * Builds the draft-article generation prompt. Per HCIQ-13 scope: for
 * weak/outdated gaps, the prompt explicitly asks for a "revision" of
 * the existing article rather than a from-scratch draft — the existing
 * article text and instruction are only included when present.
 */
export function buildDraftArticlePrompt(input: DraftArticlePromptInput): string {
  const excerptsBlock = input.representativeTicketExcerpts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const revisionContext =
    input.gapType !== "missing" && input.existingArticleText
      ? `This is a REVISION of an existing article, not a new one. Existing article content:\n${input.existingArticleText}\n\nYour draft should build on and improve this existing article, not ignore it.`
      : "This topic currently has no knowledge base article — write a brand-new draft from scratch.";

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