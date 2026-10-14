import { describe, expect, it } from "vitest";
import {
  draftToHtml,
  draftToMarkdown,
} from "../utils/draftExport";

const draft = {
  suggestedTitle: "Reset your password",
  problemSummary: "Users cannot access their account.",
  stepByStepResolution:
    "Open Settings.\nSelect Reset Password.",
  faq: [
    {
      question: "Will this log me out?",
      answer: "Yes, existing sessions may end.",
    },
  ],
  relatedKeywords: [
    "password reset",
    "account access",
  ],
  internalReviewerNotes:
    "Reviewed by the knowledge team.",
};

describe("draft export", () => {
  it("exports all draft sections as clean Markdown", () => {
    const result = draftToMarkdown(draft);

    expect(result).toContain(
      "# Reset your password",
    );
    expect(result).toContain(
      "## Problem Summary",
    );
    expect(result).toContain(
      "Users cannot access their account.",
    );
    expect(result).toContain(
      "## Resolution",
    );
    expect(result).toContain(
      "Open Settings.\nSelect Reset Password.",
    );
    expect(result).toContain("## FAQ");
    expect(result).toContain(
      "### Will this log me out?",
    );
    expect(result).toContain(
      "Yes, existing sessions may end.",
    );
    expect(result).toContain(
      "## Related Keywords",
    );
    expect(result).toContain(
      "password reset, account access",
    );
    expect(result).not.toContain(
      "## Internal Reviewer Notes",
    );
    expect(result).not.toContain(
      "Reviewed by the knowledge team.",
    );
  });

  it("exports all draft sections as HTML", () => {
    const result = draftToHtml(draft);

    expect(result).toContain(
      "<h1>Reset your password</h1>",
    );
    expect(result).toContain(
      "<h2>Problem Summary</h2>",
    );
    expect(result).toContain(
      "<h2>Resolution</h2>",
    );
    expect(result).toContain(
      "Open Settings.<br>Select Reset Password.",
    );
    expect(result).toContain("<h2>FAQ</h2>");
    expect(result).toContain(
      "<h3>Will this log me out?</h3>",
    );
    expect(result).toContain(
      "<h2>Related Keywords</h2>",
    );
    expect(result).not.toContain(
      "<h2>Internal Reviewer Notes</h2>",
    );
    expect(result).not.toContain(
      "Reviewed by the knowledge team.",
    );
  });

  it("escapes potentially unsafe HTML content", () => {
    const result = draftToHtml({
      ...draft,
      suggestedTitle:
        '<script>alert("xss")</script>',
      problemSummary:
        "Use <strong>carefully</strong> & safely.",
    });

    expect(result).not.toContain("<script>");
    expect(result).not.toContain(
      "<strong>carefully</strong>",
    );


    expect(result).toContain(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
    expect(result).toContain(
      "Use &lt;strong&gt;carefully&lt;/strong&gt; &amp; safely.",
    );
  });

  it("omits empty optional FAQ and keywords", () => {
      const result = draftToMarkdown({
      ...draft,
      faq: [],
      relatedKeywords: [],
      internalReviewerNotes: "",
    });

    expect(result).not.toContain("## FAQ");
    expect(result).not.toContain(
      "## Related Keywords",
    );
    expect(result).not.toContain(
      "Reviewed by the knowledge team.",
    );
    expect(result).toContain(
      "# Reset your password",
    );
    expect(result).toContain(
      "## Problem Summary",
    );
    expect(result).toContain(
      "## Resolution",
    );
  });
});