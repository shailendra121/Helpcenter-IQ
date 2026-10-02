import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
const mockPoolConnect = vi.fn();
const mockPoolQuery = vi.fn();
vi.mock("../../src/db/pool.js", () => ({
  pool: {
    connect: mockPoolConnect,
    query: mockPoolQuery,
  },
}));

const {
  createDraftArticle,
  listDraftArticles,
  transitionDraftStatus,
  InvalidStatusTransitionError,
  RejectionReasonRequiredError,
  DraftArticleNotFoundError,
} = await import("../../src/db/models/draftArticles.js");

describe("transitionDraftStatus — status lifecycle enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPoolConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  it("allows draft -> in_review", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ review_status: "draft" }],
      }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await expect(
      transitionDraftStatus(1, 100, "in_review")
    ).resolves.not.toThrow();

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining("zendesk_account_id = $2"),
      [1, 100]
    );

    expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("rejects draft -> approved directly", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ review_status: "draft" }],
      }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      transitionDraftStatus(1, 100, "approved")
    ).rejects.toThrow(InvalidStatusTransitionError);

    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("allows in_review -> approved", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ review_status: "in_review" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      transitionDraftStatus(1, 100, "approved")
    ).resolves.not.toThrow();

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE draft_articles"),
      ["approved", null, 1, 100]
    );

    expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("allows in_review -> rejected when a reason is provided", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ review_status: "in_review" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      transitionDraftStatus(
        1,
        100,
        "rejected",
        "Resolution steps are incorrect"
      )
    ).resolves.not.toThrow();

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE draft_articles"),
      [
        "rejected",
        "Resolution steps are incorrect",
        1,
        100,
      ]
    );
  });

  it("requires a non-empty reason when rejecting", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ review_status: "in_review" }],
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      transitionDraftStatus(1, 100, "rejected", "   ")
    ).rejects.toThrow(RejectionReasonRequiredError);

    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("rejects approved -> anything because approved is terminal", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ review_status: "approved" }],
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      transitionDraftStatus(1, 100, "draft")
    ).rejects.toThrow(InvalidStatusTransitionError);

    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("allows rejected -> draft for rework", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ review_status: "rejected" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      transitionDraftStatus(1, 100, "draft")
    ).resolves.not.toThrow();

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE draft_articles"),
      ["draft", null, 1, 100]
    );
  });

  it("throws when the draft does not exist for the Zendesk account", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      transitionDraftStatus(999, 100, "in_review")
    ).rejects.toThrow(DraftArticleNotFoundError);

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining("zendesk_account_id = $2"),
      [999, 100]
    );

    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });
 it("updates the existing draft instead of creating a new version", async () => {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [] }) // advisory lock
    .mockResolvedValueOnce({
      rows: [{ id: 501 }],
    }) // existing draft
    .mockResolvedValueOnce({ rows: [] }) // UPDATE existing draft
    .mockResolvedValueOnce({ rows: [] }); // COMMIT

  const draftId = await createDraftArticle({
    knowledgeGapId: 10,
    zendeskAccountId: 100,
    suggestedTitle: "Regenerated title",
    problemSummary: "Updated problem summary",
    stepByStepResolution: "Updated resolution",
    faq: [
      {
        question: "How do I fix this?",
        answer: "Follow the updated steps.",
      },
    ],
    relatedKeywords: ["reset", "password"],
    internalReviewerNotes: "Regenerated by AI",
    aiModelUsed: "gemini-test",
  });

  // Same existing draft is returned.
  expect(draftId).toBe(501);

  // Existing draft is found within the same Zendesk account.
  expect(mockClientQuery).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining("FROM draft_articles"),
    [10, 100]
  );

  // Regeneration updates the same row.
  expect(mockClientQuery).toHaveBeenNthCalledWith(
    4,
    expect.stringContaining("UPDATE draft_articles"),
    expect.arrayContaining([501, 100])
  );

  const executedSql = mockClientQuery.mock.calls
    .map(([sql]) => String(sql))
    .join("\n");

  // No second draft/version is inserted.
  expect(executedSql).not.toMatch(
    /INSERT\s+INTO\s+draft_articles/i
  );

  expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
  expect(mockRelease).toHaveBeenCalledOnce();
});
it("lists draft articles without version filtering", async () => {
  mockPoolQuery.mockResolvedValueOnce({
    rows: [
      {
        id: 501,
        knowledge_gap_id: 10,
        topic_summary: "Password reset",
        suggested_title: "Password reset guide",
        reviewer_suggested_title: null,
        review_status: "draft",
        created_at: new Date(),
        reviewer_edited_at: null,
        status_updated_at: null,
      },
    ],
  });

  const drafts = await listDraftArticles(100);

  expect(drafts).toHaveLength(1);
  expect(drafts[0].id).toBe(501);
  expect(drafts[0].knowledge_gap_id).toBe(10);

  expect(mockPoolQuery).toHaveBeenCalledWith(
    expect.stringContaining(
      "WHERE d.zendesk_account_id = $1"
    ),
    [100]
  );

  const sql = String(mockPoolQuery.mock.calls[0][0]);

  expect(sql).not.toContain("MAX(");
  expect(sql).not.toContain("latest.version");
  expect(sql).not.toContain("d.version");
});
});
