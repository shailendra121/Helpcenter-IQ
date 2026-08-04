import { fetchTicketPage, type FetchedTicket } from "./ticketFetcher.js";
import { upsertTicket } from "../db/models/tickets.js";
import { getCopilotFieldIds, extractCopilotValue } from "./ticketFieldsLookup.js";
import {
  createAnalysisRun,
  updateAnalysisRunCursor,
  completeAnalysisRun,
  failAnalysisRun,
  getAnalysisRun,
} from "../db/models/analysisRuns.js";

const WINDOW_DAYS_OPTIONS = [30, 60, 90] as const;
export type WindowDays = (typeof WINDOW_DAYS_OPTIONS)[number];

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function mapTicket(
  t: FetchedTicket,
  copilotFieldIds: Map<string, number>
) {
  return {
    zendeskTicketId: t.id,
    subject: t.subject ?? null,
    description: t.description ?? null,
    firstComment: t.description ?? null,
    status: t.status ?? null,
    tags: t.tags ?? [],
    zendeskCreatedAt: t.created_at ? new Date(t.created_at) : null,
    // Per Zendesk docs, Intelligent Triage fields are custom_fields
    // entries (account-specific IDs), not top-level properties —
    // resolved via getCopilotFieldIds(), not hard-coded field names.
    copilotTopic: extractCopilotValue(t.custom_fields, copilotFieldIds.get("category")),
    copilotSentiment: extractCopilotValue(t.custom_fields, copilotFieldIds.get("sentiment")),
    copilotIntent: extractCopilotValue(t.custom_fields, copilotFieldIds.get("intent")),
  };
}

export async function ingestTickets(
  zendeskAccountId: number,
  subdomain: string,
  windowDays: WindowDays,
  resumeRunId?: number
): Promise<{ runId: number; ticketCount: number }> {
  if (!WINDOW_DAYS_OPTIONS.includes(windowDays)) {
    throw new Error(
      `Invalid windowDays: ${windowDays}. Must be one of ${WINDOW_DAYS_OPTIONS.join(", ")}`
    );
  }

  let runId: number;
  let cursorOrStartTime: string | number;
  let ticketCount = 0;

  // The window boundary is creation time, per this story's intent —
  // fetched separately from the API's start_time (which filters by
  // update time and would otherwise pull in old tickets that were
  // merely touched recently).
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  if (resumeRunId) {
    const existingRun = await getAnalysisRun(resumeRunId);
    if (!existingRun) {
      throw new Error(`No analysis_run found with id ${resumeRunId} to resume`);
    }
    runId = existingRun.id;
    cursorOrStartTime = existingRun.ingestion_cursor ?? toUnixSeconds(windowStart);
  } else {
    const run = await createAnalysisRun(zendeskAccountId, windowDays);
    runId = run.id;
    cursorOrStartTime = toUnixSeconds(windowStart);
  }

  try {
    const copilotFieldIds = await getCopilotFieldIds(subdomain);
    let endOfStream = false;

    while (!endOfStream) {
      const page = await fetchTicketPage(subdomain, cursorOrStartTime);

      for (const rawTicket of page.tickets) {
        // API's start_time filters by update time; enforce the
        // creation-time window here (see comment above / PR review).
        await new Promise((resolve) => setTimeout(resolve, 500));
        const createdAt = rawTicket.created_at ? new Date(rawTicket.created_at) : null;
        if (!createdAt || createdAt < windowStart) {
          continue;
        }

        const mapped = mapTicket(rawTicket, copilotFieldIds);
        await upsertTicket({ zendeskAccountId, analysisRunId: runId, ...mapped });
        ticketCount++;
      }

      cursorOrStartTime = page.after_cursor;
      await updateAnalysisRunCursor(runId, page.after_cursor);
      endOfStream = page.end_of_stream;
    }

    await completeAnalysisRun(runId);
    return { runId, ticketCount };
  } catch (err) {
    await failAnalysisRun(runId);
    throw err;
  }
}