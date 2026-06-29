import type { AIProvider } from "./AIProvider.js";
import { AnthropicProvider } from "./AnthropicProvider.js";

/**
 * Single point of provider selection. Per ADR-0003, this is the only
 * place that should branch on AI_PROVIDER — everywhere else in the
 * codebase should depend on the AIProvider interface, not a vendor.
 */
export function createAIProvider(): AIProvider {
  const providerName = process.env.AI_PROVIDER ?? "anthropic";

  switch (providerName) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
      return new AnthropicProvider(apiKey);
    }
    // case "openai": return new OpenAIProvider(...) — add when needed.
    default:
      throw new Error(`Unknown AI_PROVIDER: ${providerName}`);
  }
}
