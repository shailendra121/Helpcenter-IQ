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

  it("does not delete the existing recommendation when AI generation fails", async () => {
    mockGenerateRecommendation.mockRejectedValue(
      new Error("AI provider failed")
    );

    const result = await runRecommendationGeneration(1, 2);

    expect(result.recommendationsCreated).toBe(0);

    expect(mockGenerateRecommendation).toHaveBeenCalledTimes(1);

    // The old recommendation must remain untouched when generation fails.
    expect(mockDeleteRecommendationsForGap).not.toHaveBeenCalled();
    expect(mockCreateRecommendation).not.toHaveBeenCalled();

    // No transaction should start because generation failed first.
    expect(mockPoolConnect).not.toHaveBeenCalled();

    // The failure should still be logged.
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("deletes the previous recommendation and creates a new one after successful generation", async () => {
    const result = await runRecommendationGeneration(1, 2);

    expect(result.recommendationsCreated).toBe(1);

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

  it("rolls back the transaction when creating the new recommendation fails", async () => {
    mockCreateRecommendation.mockRejectedValue(
      new Error("Database insert failed")
    );

    const result = await runRecommendationGeneration(1, 2);

    expect(result.recommendationsCreated).toBe(0);

    expect(mockDeleteRecommendationsForGap).toHaveBeenCalledWith(
      1,
      mockClient
    );

    expect(mockCreateRecommendation).toHaveBeenCalled();

    expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");

    expect(mockClientQuery).not.toHaveBeenCalledWith("COMMIT");

    expect(mockClientRelease).toHaveBeenCalledTimes(1);

    // The error is handled by the per-gap error isolation logic.
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});