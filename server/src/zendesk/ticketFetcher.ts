import { getValidAccessToken } from "./getValidAccessToken.js";

export interface FetchedTicket {
  id: number;
  subject: string | null;
  description: string | null;
  status: string | null;
  tags: string[];
  created_at: string;
  generated_timestamp: number;
  custom_fields?: Array<{ id: number; value: unknown }>;
}

interface IncrementalExportResponse {
  tickets: FetchedTicket[];
  end_of_stream: boolean;
  after_cursor: string;
}

const BASE_DELAY_MS = 1000;
const MAX_RETRIES = 5;

/**
 * Fetches one page of tickets via Zendesk's cursor-based Incremental
 * Ticket Export API. Chosen over the Search API per HCIQ-8: incremental
 * export is purpose-built for bulk sync, has no 1,000-result cap, and
 * cursor pagination (vs. time-based) avoids duplicate records when
 * multiple tickets share a timestamp — documented here per the story's
 * "evaluate and document the choice" requirement.
 *
 * Retries on 429 with exponential backoff, honoring Retry-After when
 * present.
 */
export async function fetchTicketPage(
  subdomain: string,
  cursorOrStartTime: string | number
): Promise<IncrementalExportResponse> {
  const accessToken = await getValidAccessToken(subdomain);
  const url =
    typeof cursorOrStartTime === "string"
      ? `https://${subdomain}.zendesk.com/api/v2/incremental/tickets/cursor.json?cursor=${encodeURIComponent(cursorOrStartTime)}`
      : `https://${subdomain}.zendesk.com/api/v2/incremental/tickets/cursor.json?start_time=${cursorOrStartTime}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : BASE_DELAY_MS * Math.pow(2, attempt);
      if (attempt === MAX_RETRIES) {
        throw new Error(`Rate limited by Zendesk after ${MAX_RETRIES} retries`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Zendesk incremental export failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as IncrementalExportResponse;
  }

  throw new Error("Unreachable: retry loop exited without returning or throwing");
}