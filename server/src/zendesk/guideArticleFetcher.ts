import { getValidAccessToken } from "./getValidAccessToken.js";
import { convert as htmlToText } from "html-to-text";

export interface FetchedArticle {
  id: number;
  title: string | null;
  body: string | null; // raw HTML
  locale: string;
  draft: boolean;
  section_id: number | null;
  created_at: string;
  updated_at: string;
}

interface IncrementalArticlesResponse {
  articles: FetchedArticle[];
  next_page: string | null;
  end_time: number;
}

const BASE_DELAY_MS = 1000;
const MAX_RETRIES = 5;

/**
 * Fetches one page of Guide articles via Zendesk's Incremental Article
 * Export API — same rationale as HCIQ-8's ticket fetcher: purpose-built
 * for bulk sync, avoids the 1,000-result cap of offset pagination, and
 * returns any article whose metadata changed since start_time (used for
 * incremental refresh).
 *
 * Retries on 429 with exponential backoff, honoring Retry-After.
 */
export async function fetchArticlePage(
  subdomain: string,
  startTime: number
): Promise<IncrementalArticlesResponse> {
  const accessToken = await getValidAccessToken(subdomain);
  const url = `https://${subdomain}.zendesk.com/api/v2/help_center/incremental/articles?start_time=${startTime}`;

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
      throw new Error(`Zendesk incremental articles export failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as IncrementalArticlesResponse;
  }

  throw new Error("Unreachable: retry loop exited without returning or throwing");
}

/**
 * Converts an article's HTML body to clean plain text for embedding.
 * Strips tags/scripts/styles, collapses whitespace.
 */
export function cleanArticleBody(html: string | null): string {
  if (!html) return "";
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  }).trim();
}