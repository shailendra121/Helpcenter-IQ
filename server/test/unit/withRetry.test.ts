import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../src/ai/withRetry.js";

describe("withRetry", () => {
  it("returns the result immediately on success, no retry needed", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a rate-limit error and eventually succeeds", async () => {
    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("429 RESOURCE_EXHAUSTED: rate limit exceeded");
      }
      return "success after retries";
    });

    const result = await withRetry(fn);

    expect(result).toBe("success after retries");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on a non-rate-limit error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Invalid API key"));

    await expect(withRetry(fn)).rejects.toThrow("Invalid API key");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries on a Gemini 503 high-demand error", async () => {
  let attempts = 0;

  const fn = vi.fn().mockImplementation(async () => {
    attempts++;

    if (attempts < 3) {
      throw new Error(
        '{"error":{"code":503,"status":"UNAVAILABLE","message":"This model is currently experiencing high demand"}}',
      );
    }

    return "success after 503 retries";
  });

  const result = await withRetry(fn);

  expect(result).toBe("success after 503 retries");
  expect(fn).toHaveBeenCalledTimes(3);
});

  it("throws after exhausting max retries on persistent rate limiting", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("429 rate limit"));

    await expect(withRetry(fn)).rejects.toThrow("429 rate limit");
    expect(fn).toHaveBeenCalledTimes(6); // initial + 5 retries
  }, 40000);
});