import "dotenv/config";
import { describe, it, expect, vi } from "vitest";
import { maskPII } from "../../src/pii/maskPII.js";
import { createAIProvider } from "../../src/ai/providers/index.js";

describe("PII masking before embed()", () => {
  it("redacts PII from sample text before it is sent to the AI provider, and returns a real embedding vector", async () => {
    const rawText =
      "Customer email: jane.doe@example.com, phone: +1 555-123-4567. " +
      "Ticket: I can't log into my account.";

    const { maskedText, redactionCount } = maskPII(rawText);

    // Prove masking actually happened.
    expect(redactionCount).toBeGreaterThan(0);
    expect(maskedText).toContain("[REDACTED]");

    const provider = createAIProvider();

    // Spy on embed() so we can inspect exactly what text it was called
    // with — this is what actually catches a regression where someone
    // bypasses masking and passes rawText directly to embed().
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

    // Prove a real embedding vector came back.
    expect(Array.isArray(result.vector)).toBe(true);
    expect(result.vector.length).toBeGreaterThan(0);
    expect(typeof result.vector[0]).toBe("number");
  }, 20000);
});