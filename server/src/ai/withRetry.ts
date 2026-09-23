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
function getMinIntervalMs(): number {
  return Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 1000);
}

let lastCallStartedAt = 0;
let throttleQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes access to the global throttle and ensures that at least
 * GEMINI_MIN_INTERVAL_MS passes between AI call starts.
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
    const remaining = getMinIntervalMs() - elapsed;

    if (remaining > 0) {
      await sleep(remaining);
    }

    lastCallStartedAt = Date.now();
  } finally {
    release();
  }
}

/**
 * Determines whether an AI/provider error is transient and should be retried.
 *
 * Covers provider-side transient failures:
 * - HTTP 429 / rate limits
 * - Gemini RESOURCE_EXHAUSTED
 * - HTTP 503 / UNAVAILABLE
 * - temporary "high demand" responses
 *
 * Covers network-level transient failures:
 * - ENOTFOUND
 * - EAI_AGAIN
 * - ECONNRESET
 * - ETIMEDOUT
 * - UND_ERR_CONNECT_TIMEOUT
 * - fetch failed
 *
 * Some Node/undici fetch errors expose the useful network reason through
 * error.cause rather than the top-level error message, so both are checked.
 */
function isRetryableAIError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error);

  const causeMessage =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";

  const combinedMessage = `${message} ${causeMessage}`;

  return /429|rate limit|RESOURCE_EXHAUSTED|503|UNAVAILABLE|high demand|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|fetch failed/i.test(
    combinedMessage
  );
}

/**
 * Extracts a provider-suggested retry delay from the error message.
 *
 * Gemini 429 errors may include values such as:
 *   "retryDelay": "40s"
 *
 * Returns milliseconds, or null when the provider did not supply one.
 */
function getProviderRetryDelayMs(error: unknown): number | null {
  const message =
    error instanceof Error ? error.message : String(error);

  const causeMessage =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";

  const combinedMessage = `${message} ${causeMessage}`;

  const match = combinedMessage.match(
    /["']?retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s["']?/i
  );

  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);

  return Number.isFinite(seconds)
    ? Math.ceil(seconds * 1000)
    : null;
}

/**
 * Runs an AI provider call with:
 * 1. Global process-wide throttling
 * 2. Exponential backoff for transient provider/network failures
 * 3. Provider-suggested retry delays when available
 */
export async function withRetry<T>(
  fn: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForGlobalThrottle();

    try {
      return await fn();
    } catch (error) {
      if (!isRetryableAIError(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const exponentialDelayMs =
        BASE_DELAY_MS * Math.pow(2, attempt);

      const providerDelayMs =
        getProviderRetryDelayMs(error);

      const delayMs = Math.max(
        exponentialDelayMs,
        providerDelayMs ?? 0
      );

      await sleep(delayMs);
    }
  }

  throw new Error(
    "Unreachable: retry loop exited without returning or throwing"
  );
}
