import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetchTicketPage = vi.fn();
vi.mock("../../src/zendesk/ticketFetcher.js", () => ({
  fetchTicketPage: mockFetchTicketPage,
}));

const mockUpsertTicket = vi.fn();
vi.mock("../../src/db/models/tickets.js", () => ({
  upsertTicket: mockUpsertTicket,
}));

const mockCreateAnalysisRun = vi.fn();
const mockUpdateAnalysisRunCursor = vi.fn();
const mockCompleteAnalysisRun = vi.fn();
const mockFailAnalysisRun = vi.fn();
const mockGetAnalysisRun = vi.fn();
vi.mock("../../src/db/models/analysisRuns.js", () => ({
  createAnalysisRun: mockCreateAnalysisRun,
  updateAnalysisRunCursor: mockUpdateAnalysisRunCursor,
  completeAnalysisRun: mockCompleteAnalysisRun,
  failAnalysisRun: mockFailAnalysisRun,
  getAnalysisRun: mockGetAnalysisRun,
}));

const { ingestTickets } = await import("../../src/zendesk/ingestTickets.js");

describe("ingestTickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ingests all tickets across multiple pages and marks the run complete", async () => {
    mockCreateAnalysisRun.mockResolvedValue({ id: 1 });
    mockFetchTicketPage
      .mockResolvedValueOnce({
        tickets: [{ id: 101, subject: "Ticket A", status: "open", tags: [], created_at: "2026-01-01T00:00:00Z", generated_timestamp: 1 }],
        end_of_stream: false,
        after_cursor: "cursor-page-2",
      })
      .mockResolvedValueOnce({
        tickets: [{ id: 102, subject: "Ticket B", status: "open", tags: [], created_at: "2026-01-02T00:00:00Z", generated_timestamp: 2 }],
        end_of_stream: true,
        after_cursor: "cursor-final",
      });

    const result = await ingestTickets(1, "d3v-astonous", 30);

    expect(result.ticketCount).toBe(2);
    expect(mockUpsertTicket).toHaveBeenCalledTimes(2);
    expect(mockCompleteAnalysisRun).toHaveBeenCalledWith(1);
    expect(mockFailAnalysisRun).not.toHaveBeenCalled();
  });

  it("resumes an interrupted run from its saved cursor instead of restarting", async () => {
    mockGetAnalysisRun.mockResolvedValue({
      id: 5,
      ingestion_cursor: "saved-cursor-xyz",
    });
    mockFetchTicketPage.mockResolvedValue({
      tickets: [],
      end_of_stream: true,
      after_cursor: "cursor-final",
    });

    await ingestTickets(1, "d3v-astonous", 30, 5);

    // Proves resume uses the saved cursor, not a fresh start-time —
    // createAnalysisRun should never be called on a resume.
    expect(mockCreateAnalysisRun).not.toHaveBeenCalled();
    expect(mockFetchTicketPage).toHaveBeenCalledWith("d3v-astonous", "saved-cursor-xyz");
  });

  it("rejects an invalid windowDays value", async () => {
    await expect(
      // @ts-expect-error intentionally invalid for this test
      ingestTickets(1, "d3v-astonous", 45)
    ).rejects.toThrow("Invalid windowDays");
  });

  it("marks the run as failed if a page fetch throws", async () => {
    mockCreateAnalysisRun.mockResolvedValue({ id: 2 });
    mockFetchTicketPage.mockRejectedValue(new Error("Zendesk API down"));

    await expect(ingestTickets(1, "d3v-astonous", 30)).rejects.toThrow("Zendesk API down");
    expect(mockFailAnalysisRun).toHaveBeenCalledWith(2);
    expect(mockCompleteAnalysisRun).not.toHaveBeenCalled();
  });

  it("relies on upsertTicket's unique constraint for idempotency on re-runs", async () => {
    // This test documents the idempotency mechanism: upsertTicket uses
    // ON CONFLICT (zendesk_account_id, zendesk_ticket_id) DO UPDATE,
    // so calling ingestTickets twice with overlapping tickets calls
    // upsertTicket each time but never creates duplicate rows — the
    // real duplicate-prevention guarantee lives in the DB constraint
    // (see tickets migration), verified separately at the DB layer.
    mockCreateAnalysisRun.mockResolvedValue({ id: 3 });
    mockFetchTicketPage.mockResolvedValue({
      tickets: [{ id: 999, subject: "Same ticket", status: "open", tags: [], created_at: "2026-01-01T00:00:00Z", generated_timestamp: 1 }],
      end_of_stream: true,
      after_cursor: "cursor-final",
    });

    await ingestTickets(1, "d3v-astonous", 30);
    await ingestTickets(1, "d3v-astonous", 30);

    expect(mockUpsertTicket).toHaveBeenCalledTimes(2); // called twice, but same ticket ID both times — DB constraint handles the actual dedup
  });
});