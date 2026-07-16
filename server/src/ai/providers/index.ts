import type { AIProvider } from "./AIProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";

/**
 * Single point of provider selection. Per ADR-0003/ADR-0006, this is the
 * only place that should branch on AI_PROVIDER — everywhere else in the
 * codebase should depend on the AIProvider interface, not a vendor.
 */
export function createAIProvider(): AIProvider {
  const providerName = process.env.AI_PROVIDER ?? "gemini";

  switch (providerName) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
      return new GeminiProvider(apiKey);
    }
    default:
      throw new Error(`Unknown AI_PROVIDER: ${providerName}`);
  }
}