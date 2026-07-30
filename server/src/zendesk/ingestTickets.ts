import { fetchTicketPage, type FetchedTicket } from "./ticketFetcher.js";
import { upsertTicket } from "../db/models/tickets.js";
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

function mapTicket(t: FetchedTicket): {
  zendeskTicketId: number;
  subject: string | null;
  description: string | null;
  firstComment: string | null;
  status: string | null;
  tags: string[];
  zendeskCreatedAt: Date | null;
  copilotTopic: string | null;
  copilotSentiment: string | null;
  copilotIntent: string | null;
} {
  return {
    zendeskTicketId: t.id,
    subject: t.subject ?? null,
    description: t.description ?? null,
    // The incremental export ticket object doesn't include the full
    // comment thread — description is the ticket's original comment
    // text for the vast majority of tickets. A separate per-ticket
    // comments call would add an API call per ticket (N+1), which
    // isn't justified for this story's scope. Flagged for review —
    // fuller comment fetching can be a follow-up if description proves
    // insufficient for the clustering story (HCIQ-10).
    firstComment: t.description ?? null,
    status: t.status ?? null,
    tags: t.tags ?? [],
    zendeskCreatedAt: t.created_at ? new Date(t.created_at) : null,
    copilotTopic: t.topic ?? null,
    copilotSentiment: t.sentiment ?? null,
    copilotIntent: t.intent ?? null,
  };
}

/**
 * Ingests all tickets for a Zendesk account within the given lookback
 * window, using cursor-based pagination. If resumeRunId is provided,
 * resumes an interrupted run from its saved cursor instead of
 * restarting from the beginning of the window (HCIQ-8 requirement).
 */
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

  if (resumeRunId) {
    const existingRun = await getAnalysisRun(resumeRunId);
    if (!existingRun) {
      throw new Error(`No analysis_run found with id ${resumeRunId} to resume`);
    }
    runId = existingRun.id;
    cursorOrStartTime =
      existingRun.ingestion_cursor ??
      toUnixSeconds(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000));
  } else {
    const run = await createAnalysisRun(zendeskAccountId, windowDays);
    runId = run.id;
    cursorOrStartTime = toUnixSeconds(
      new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    );
  }

  try {
    let endOfStream = false;

    while (!endOfStream) {
      const page = await fetchTicketPage(subdomain, cursorOrStartTime);

      for (const rawTicket of page.tickets) {
        const mapped = mapTicket(rawTicket);
        await upsertTicket({
          zendeskAccountId,
          analysisRunId: runId,
          ...mapped,
        });
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