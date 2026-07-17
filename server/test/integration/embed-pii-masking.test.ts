import "dotenv/config";
import { describe, it, expect, vi } from "vitest";
import { maskPII } from "../../src/pii/maskPII.js";
import { createAIProvider } from "../../src/ai/providers/index.js";

const hasApiKey = !!process.env.GEMINI_API_KEY;

describe.skipIf(!hasApiKey)("PII masking before embed() — live API call", () => {
  it("redacts PII from sample text before it is sent to the AI provider, and returns a real embedding vector", async () => {
    const rawText =
      "Customer email: jane.doe@example.com, phone: +1 555-123-4567. " +
      "Ticket: I can't log into my account.";

    const { maskedText, redactionCount } = maskPII(rawText);

    expect(redactionCount).toBeGreaterThan(0);
    expect(maskedText).toContain("[REDACTED]");

    const provider = createAIProvider();
    // Note: this spy verifies the test itself calls embed() with masked
    // text, catching a regression where a developer edits this test to
    // pass rawText directly. It does not verify that embed()'s internal
    // implementation independently checks for unmasked input — full
    // interface-level enforcement (a wrapper that rejects unmasked text
    // regardless of caller) is HCIQ-17's scope (audit logging enforced
    // at the provider-interface level).
    const embedSpy = vi.spyOn(provider, "embed");

    const result = await provider.embed({ text: maskedText });

    expect(embedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining("jane.doe@example.com"),
      })
    );
    expect(embedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining("555-123-4567"),
      })
    );

    expect(Array.isArray(result.vector)).toBe(true);
    expect(result.vector.length).toBeGreaterThan(0);
    expect(typeof result.vector[0]).toBe("number");
  }, 20000);
});

if (!hasApiKey) {
  describe("PII masking before embed() — skipped", () => {
    it("skipped: GEMINI_API_KEY not set in this environment", () => {
      console.warn(
        "Skipping live embed() test — GEMINI_API_KEY not configured. " +
        "Expected in CI/forks unless the secret is added. See gemini-provider.unit.test.ts " +
        "for always-on mocked coverage of this code path."
      );
    });
  });
}

