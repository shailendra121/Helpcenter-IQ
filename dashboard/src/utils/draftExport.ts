export interface ExportableDraft {
  suggestedTitle: string;
  problemSummary: string;
  stepByStepResolution: string;
  faq: Array<{
    question: string;
    answer: string;
  }>;
  relatedKeywords: string[];
  internalReviewerNotes: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function draftToMarkdown(
  draft: ExportableDraft,
): string {
  const sections: string[] = [
    `# ${draft.suggestedTitle.trim()}`,
    "",
    "## Problem Summary",
    draft.problemSummary.trim(),
    "",
    "## Resolution",
    draft.stepByStepResolution.trim(),
  ];

  if (draft.faq.length > 0) {
    sections.push("", "## FAQ");

    for (const item of draft.faq) {
      sections.push(
        "",
        `### ${item.question.trim()}`,
        item.answer.trim(),
      );
    }
  }

  if (draft.relatedKeywords.length > 0) {
    sections.push(
      "",
      "## Related Keywords",
      draft.relatedKeywords
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .join(", "),
    );
  }
  return sections.join("\n").trim();
}

export function draftToHtml(
  draft: ExportableDraft,
): string {
  const parts: string[] = [
    `<h1>${escapeHtml(draft.suggestedTitle.trim())}</h1>`,
    "<h2>Problem Summary</h2>",
    `<p>${escapeHtml(draft.problemSummary.trim())}</p>`,
    "<h2>Resolution</h2>",
    `<p>${escapeHtml(draft.stepByStepResolution.trim()).replace(/\n/g, "<br>")}</p>`,
  ];

  if (draft.faq.length > 0) {
    parts.push("<h2>FAQ</h2>");

    for (const item of draft.faq) {
      parts.push(
        `<h3>${escapeHtml(item.question.trim())}</h3>`,
        `<p>${escapeHtml(item.answer.trim()).replace(/\n/g, "<br>")}</p>`,
      );
    }
  }

  const keywords = draft.relatedKeywords
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  if (keywords.length > 0) {
    parts.push(
      "<h2>Related Keywords</h2>",
      `<p>${keywords.map(escapeHtml).join(", ")}</p>`,
    );
  }
  return parts.join("\n");
}