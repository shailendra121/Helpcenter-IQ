import { describe, it, expect, vi } from "vitest";

// Mock @google/genai before importing GeminiProvider, so no real network
// call is ever made — this test must be always-on in CI, unlike the live
// integration test which requires a real API key.
const mockEmbedContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      embedContent: mockEmbedContent,
    },
  })),
}));

const { GeminiProvider, normalize } = await import("../../src/ai/providers/GeminiProvider.js");

describe("GeminiProvider.embed() — mocked, always-on", () => {
  it("calls embedContent with the correct model and 1536 outputDimensionality config", async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: Array(1536).fill(0.1) }],
    });

    const provider = new GeminiProvider("fake-test-key");
    await provider.embed({ text: "some masked text" });

    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: "some masked text",
        config: expect.objectContaining({ outputDimensionality: 1536 }),
      })
    );
  });

  it("throws a clear error when the API returns no embedding values", async () => {
    mockEmbedContent.mockResolvedValueOnce({ embeddings: [] });

    const provider = new GeminiProvider("fake-test-key");

    await expect(provider.embed({ text: "some masked text" })).rejects.toThrow(
      "Gemini embedContent returned no embedding values"
    );
  });
});

describe("normalize()", () => {
  it("returns a unit vector (magnitude 1)", () => {
    const input = [3, 4]; // magnitude 5
    const result = normalize(input);
    const magnitude = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 10);
    expect(result).toEqual([0.6, 0.8]);
  });

  it("handles a zero vector without dividing by zero", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

