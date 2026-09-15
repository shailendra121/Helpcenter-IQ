import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

const mockGetTicketsByIds = vi.fn();
const mockCreateRecommendation = vi.fn();
const mockDeleteRecommendationsForGap = vi.fn();
const mockGenerateRecommendation = vi.fn();

vi.mock("../../src/db/pool.js", () => ({
  pool: {
    query: mockPoolQuery,
    connect: mockPoolConnect,
  },
}));

vi.mock("../../src/db/models/tickets.js", () => ({
  getTicketsByIds: mockGetTicketsByIds,
}));

vi.mock("../../src/db/models/gapRecommendations.js", () => ({
  createRecommendation: mockCreateRecommendation,
  deleteRecommendationsForGap: mockDeleteRecommendationsForGap,
}));

vi.mock("../../src/recommendations/generateRecommendation.js", () => ({
  generateRecommendation: mockGenerateRecommendation,
}));

const { runRecommendationGeneration } = await import(
  "../../src/recommendations/runRecommendationGeneration.js"
);

const mockClient = {
  query: mockClientQuery,
  release: mockClientRelease,
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe("runRecommendationGeneration — recommendation replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mockPoolConnect.mockResolvedValue(mockClient);

    mockPoolQuery.mockImplementation((query: string) => {
      if (query.includes("FROM knowledge_gaps")) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              cluster_id: 10,
              topic_summary: "Password reset issues",
              classification: "weak",
              justification: "The article is incomplete.",
              related_guide_article_id: 20,
            },
          ],
        });
      }

      if (query.includes("FROM ticket_clusters")) {
        return Promise.resolve({
          rows: [
            {
              representative_ticket_ids: ["100", "101"],
            },
          ],
        });
      }

      if (query.includes("FROM guide_articles")) {
        return Promise.resolve({
          rows: [
            {
              title: "Password Reset Steps",
              clean_text: "Click reset to reset your password.",
            },
          ],
        });
      }

      return Promise.resolve({ rows: [] });
    });

    mockGetTicketsByIds.mockResolvedValue([
      {
        subject: "Cannot reset password",
        description: "The reset email never arrives.",
      },
      {
        subject: "Password reset not working",
        description: "I cannot reset my password.",
      },
    ]);

    mockGenerateRecommendation.mockResolvedValue({
      type: "add_missing_steps",
      rationale: "The article is missing troubleshooting steps.",
      suggestedKeywords: ["password", "reset"],
      suggestedTitle: null,
    });

    mockDeleteRecommendationsForGap.mockResolvedValue(undefined);
    mockCreateRecommendation.mockResolvedValue(123);

    mockClientQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves the existing recommendation and fails the stage when AI generation fails", async () => {
    mockGenerateRecommendation.mockRejectedValue(
      new Error("AI provider failed")
    );

    await expect(
      runRecommendationGeneration(1, 2)
    ).rejects.toThrow(
      "Recommendation generation failed for 1 gap(s)"
    );

    // Tenancy regression protection:
    // representative ticket lookup must stay scoped
    // to the Zendesk account.
    expect(mockGetTicketsByIds).toHaveBeenCalledTimes(1);

    expect(mockGetTicketsByIds).toHaveBeenCalledWith(
      [100, 101],
      1
    );

    expect(mockGenerateRecommendation).toHaveBeenCalledTimes(1);

    // Generate-first behavior: the old recommendation remains untouched
    // if the AI call fails.
    expect(
      mockDeleteRecommendationsForGap
    ).not.toHaveBeenCalled();

    expect(
      mockCreateRecommendation
    ).not.toHaveBeenCalled();

    // No transaction starts because generation failed before DB replacement.
    expect(mockPoolConnect).not.toHaveBeenCalled();

    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("deletes the previous recommendation and creates a new one after successful generation", async () => {
    const result = await runRecommendationGeneration(1, 2);

    expect(result.recommendationsCreated).toBe(1);

    expect(mockGetTicketsByIds).toHaveBeenCalledTimes(1);

    expect(mockGetTicketsByIds).toHaveBeenCalledWith(
      [100, 101],
      1
    );

    expect(mockGenerateRecommendation).toHaveBeenCalledTimes(1);
    expect(mockPoolConnect).toHaveBeenCalledTimes(1);

    expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");

    expect(mockDeleteRecommendationsForGap).toHaveBeenCalledWith(
      1,
      mockClient
    );

    expect(mockCreateRecommendation).toHaveBeenCalledWith(
      {
        zendeskAccountId: 1,
        gapId: 1,
        type: "add_missing_steps",
        rationale: "The article is missing troubleshooting steps.",
        suggestedKeywords: ["password", "reset"],
        suggestedTitle: null,
      },
      mockClient
    );

    expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");

    expect(mockClientRelease).toHaveBeenCalledTimes(1);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("rolls back the transaction and fails the stage when creating the new recommendation fails", async () => {
    mockCreateRecommendation.mockRejectedValue(
      new Error("Database insert failed")
    );

    await expect(
      runRecommendationGeneration(1, 2)
    ).rejects.toThrow(
      "Recommendation generation failed for 1 gap(s)"
    );

    expect(mockGetTicketsByIds).toHaveBeenCalledTimes(1);

    expect(mockGetTicketsByIds).toHaveBeenCalledWith(
      [100, 101],
      1
    );

    expect(mockDeleteRecommendationsForGap).toHaveBeenCalledWith(
      1,
      mockClient
    );

    expect(mockCreateRecommendation).toHaveBeenCalled();

    expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");

    expect(mockClientQuery).not.toHaveBeenCalledWith("COMMIT");

    expect(mockClientRelease).toHaveBeenCalledTimes(1);

    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});