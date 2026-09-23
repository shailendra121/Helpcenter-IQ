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

    // Keep retry tests independent from local .env throttle settings.
    process.env.GEMINI_MIN_INTERVAL_MS = "0";
  });

  it("returns the result immediately on success, no retry needed", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success"
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
          "429 RESOURCE_EXHAUSTED: rate limit exceeded"
        );
      }

      return "success after retries";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after retries"
    );

    // 1s + 2s exponential backoff.
    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("honors Gemini provider retryDelay when it exceeds exponential backoff", async () => {
    let attempts = 0;
    const callTimes: number[] = [];

    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      callTimes.push(Date.now());

      if (attempts === 1) {
        throw new Error(
          '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"},"retryDelay":"40s"}'
        );
      }

      return "success after provider delay";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after provider delay"
    );

    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(2);

    // The provider requested a 40-second delay.
    // Verify that it takes precedence over the normal
    // 1-second exponential backoff for the first retry.
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(
      40_000
    );
  });

  it("does NOT retry on a non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(
      new Error("Invalid API key")
    );

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).rejects.toThrow(
      "Invalid API key"
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
          '{"error":{"code":503,"status":"UNAVAILABLE","message":"This model is currently experiencing high demand"}}'
        );
      }

      return "success after 503 retries";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after 503 retries"
    );

    // 1s + 2s exponential backoff.
    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on ENOTFOUND and eventually succeeds", async () => {
    let attempts = 0;

    const fn = vi.fn().mockImplementation(async () => {
      attempts++;

      if (attempts < 2) {
        throw new Error(
          "getaddrinfo ENOTFOUND generativelanguage.googleapis.com"
        );
      }

      return "success after DNS retry";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after DNS retry"
    );

    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on UND_ERR_CONNECT_TIMEOUT and eventually succeeds", async () => {
    let attempts = 0;

    const fn = vi.fn().mockImplementation(async () => {
      attempts++;

      if (attempts < 2) {
        throw new Error("UND_ERR_CONNECT_TIMEOUT");
      }

      return "success after connection retry";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after connection retry"
    );

    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries when fetch failed contains a transient network cause", async () => {
    let attempts = 0;

    const fn = vi.fn().mockImplementation(async () => {
      attempts++;

      if (attempts < 2) {
        const error = new Error("fetch failed");

        error.cause = new Error(
          "connect ETIMEDOUT 142.250.0.1:443"
        );

        throw error;
      }

      return "success after fetch retry";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after fetch retry"
    );

    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on ECONNRESET", async () => {
    let attempts = 0;

    const fn = vi.fn().mockImplementation(async () => {
      attempts++;

      if (attempts < 2) {
        throw new Error("read ECONNRESET");
      }

      return "success after reset";
    });

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).resolves.toBe(
      "success after reset"
    );

    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting max retries on persistent rate limiting", async () => {
    const fn = vi.fn().mockRejectedValue(
      new Error("429 rate limit")
    );

    const resultPromise = withRetry(fn);

    const resultAssertion = expect(resultPromise).rejects.toThrow(
      "429 rate limit"
    );

    // 1s + 2s + 4s + 8s + 16s = 31s virtual time.
    await vi.runAllTimersAsync();
    await resultAssertion;

    expect(fn).toHaveBeenCalledTimes(6);
  });
});
