import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPoolQuery = vi.fn();
vi.mock("../../src/db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

const { transitionDraftStatus, InvalidStatusTransitionError } = await import(
  "../../src/db/models/draftArticles.js"
);

describe("transitionDraftStatus — status lifecycle enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows draft -> in_review", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ review_status: "draft" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(transitionDraftStatus(1, "in_review")).resolves.not.toThrow();
  });

  it("rejects draft -> approved directly (must go through in_review)", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ review_status: "draft" }] });

    await expect(transitionDraftStatus(1, "approved")).rejects.toThrow(
      InvalidStatusTransitionError
    );
  });

  it("allows in_review -> approved", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ review_status: "in_review" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(transitionDraftStatus(1, "approved")).resolves.not.toThrow();
  });

  it("allows in_review -> rejected", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ review_status: "in_review" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(transitionDraftStatus(1, "rejected")).resolves.not.toThrow();
  });

  it("rejects approved -> anything (terminal state)", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ review_status: "approved" }] });

    await expect(transitionDraftStatus(1, "draft")).rejects.toThrow(
      InvalidStatusTransitionError
    );
  });

  it("allows rejected -> draft (rework)", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ review_status: "rejected" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(transitionDraftStatus(1, "draft")).resolves.not.toThrow();
  });

  it("throws if the draft doesn't exist", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await expect(transitionDraftStatus(999, "in_review")).rejects.toThrow(
      "No draft article found"
    );
  });
});