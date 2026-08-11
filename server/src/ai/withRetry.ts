const BASE_DELAY_MS = 1000;
const MAX_RETRIES = 5;

/**
 * Wraps an AI provider call with exponential backoff retry, for cases
 * where the underlying SDK throws a rate-limit error rather than
 * returning a structured 429 response (unlike our raw fetch() calls in
 * ticketFetcher.ts/guideArticleFetcher.ts, which handle this inline).
 * Retries on errors whose message suggests a rate limit; other errors
 * are re-thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isRateLimit = /rate limit|429|RESOURCE_EXHAUSTED/i.test(message);

      if (!isRateLimit || attempt === MAX_RETRIES) {
        throw err;
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Unreachable: retry loop exited without returning or throwing");
}