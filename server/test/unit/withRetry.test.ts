import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { withRetry } from "../../src/ai/withRetry.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it("returns the result immediately on success, no retry needed", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success",
    );

    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a rate-limit error and eventually succeeds", async () => {
    let attempts = 0;

    const fn = vi.fn().mockImplementation(async () => {
      attempts++;

      if (attempts < 3) {
        throw new Error(
          "429 RESOURCE_EXHAUSTED: rate limit exceeded",
        );
      }

      return "success after retries";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after retries",
    );

    // 1s + 2s exponential backoff.
    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on a non-rate-limit error", async () => {
    const fn = vi.fn().mockRejectedValue(
      new Error("Invalid API key"),
    );

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).rejects.toThrow(
      "Invalid API key",
    );

    await vi.runAllTimersAsync();
    await resultAssertion;

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

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after 503 retries",
    );

    // 1s + 2s exponential backoff.
    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting max retries on persistent rate limiting", async () => {
    const fn = vi.fn().mockRejectedValue(
      new Error("429 rate limit"),
    );

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).rejects.toThrow(
      "429 rate limit",
    );

    // 1s + 2s + 4s + 8s + 16s = 31s virtual time.
    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(6);
  });
});