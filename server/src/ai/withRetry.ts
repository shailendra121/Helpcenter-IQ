const BASE_DELAY_MS = 1000;
const MAX_RETRIES = 5;

/**
 * Minimum spacing between Gemini calls.
 *
 * This is intentionally process-global so every AI call in this
 * server process shares the same throttle, regardless of pipeline stage.
 *
 * Set GEMINI_MIN_INTERVAL_MS=0 to disable throttling locally.
 */
const MIN_INTERVAL_MS = Number(
  process.env.GEMINI_MIN_INTERVAL_MS ?? 1000,
);

let lastCallStartedAt = 0;
let throttleQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes access to the global throttle and ensures that at least
 * MIN_INTERVAL_MS passes between AI call starts.
 */
async function waitForGlobalThrottle(): Promise<void> {
  let release!: () => void;

  const previous = throttleQueue;

  throttleQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    const elapsed = Date.now() - lastCallStartedAt;
    const remaining = MIN_INTERVAL_MS - elapsed;

    if (remaining > 0) {
      await sleep(remaining);
    }

    lastCallStartedAt = Date.now();
  } finally {
    release();
  }
}

/**
 * Determines whether an AI error is transient and should be retried.
 *
 * Covers:
 * - HTTP 429 / rate limits
 * - Gemini RESOURCE_EXHAUSTED
 * - HTTP 503 / UNAVAILABLE
 * - temporary "high demand" responses
 */
function isRetryableAIError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /429|rate limit|RESOURCE_EXHAUSTED|503|UNAVAILABLE|high demand/i.test(
    message,
  );
}

/**
 * Runs an AI provider call with:
 * 1. Global process-wide throttling
 * 2. Exponential backoff for transient Gemini failures
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForGlobalThrottle();

    try {
      return await fn();
    } catch (error) {
      if (!isRetryableAIError(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);

      await sleep(delayMs);
    }
  }

  throw new Error(
    "Unreachable: retry loop exited without returning or throwing",
  );
}