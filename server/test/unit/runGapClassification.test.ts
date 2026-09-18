import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetClustersForRun = vi.fn();
const mockGetTicketsByIds = vi.fn();
const mockCreateKnowledgeGap = vi.fn();
const mockDeleteGapsForRun = vi.fn();
const mockClassifyGap = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock("../../src/db/models/ticketClusters.js", () => ({
  getClustersForRun: mockGetClustersForRun,
}));

vi.mock("../../src/db/models/tickets.js", () => ({
  getTicketsByIds: mockGetTicketsByIds,
}));

vi.mock("../../src/db/models/knowledgeGaps.js", () => ({
  createKnowledgeGap: mockCreateKnowledgeGap,
  deleteGapsForRun: mockDeleteGapsForRun,
}));

vi.mock("../../src/classification/classifyGap.js", () => ({
  classifyGap: mockClassifyGap,
}));

vi.mock("../../src/db/pool.js", () => ({
  pool: {
    query: mockPoolQuery,
  },
}));

const { runGapClassification } = await import(
  "../../src/classification/runGapClassification.js"
);

function makeCluster(id: number) {
  return {
    id,
    topic_label: `Topic ${id}`,
    topic_summary: `Topic summary ${id}`,
    ticket_count: 3,
    representative_ticket_ids: [id * 10],
  };
}

describe("runGapClassification", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDeleteGapsForRun.mockResolvedValue(undefined);

    mockGetTicketsByIds.mockResolvedValue([
      {
        id: 10,
        subject: "Example ticket",
        description: "Example description",
      },
    ]);

    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          centroid_embedding: "[0.1,0.2,0.3]",
        },
      ],
    });

    mockClassifyGap.mockResolvedValue({
      classification: "missing",
      priorityScore: 9,
      relatedGuideArticleId: null,
      similarityScore: null,
      justification: "No published article covers this topic.",
    });

    mockCreateKnowledgeGap.mockResolvedValue(undefined);
  });

  it("returns the number of gaps created when all clusters succeed", async () => {
    mockGetClustersForRun.mockResolvedValue([
      makeCluster(1),
      makeCluster(2),
    ]);

    const result = await runGapClassification(1, 100);

    expect(result).toEqual({
      gapsCreated: 2,
    });

    expect(mockDeleteGapsForRun).toHaveBeenCalledWith(
      1,
      100
    );

    // Tenancy regression protection:
    // every representative-ticket lookup must be scoped to
    // the same Zendesk account as the analysis run.
    expect(mockGetTicketsByIds).toHaveBeenCalledTimes(2);

    expect(mockGetTicketsByIds).toHaveBeenNthCalledWith(
      1,
      [10],
      1
    );

    expect(mockGetTicketsByIds).toHaveBeenNthCalledWith(
      2,
      [20],
      1
    );

    expect(mockClassifyGap).toHaveBeenCalledTimes(2);
    expect(mockCreateKnowledgeGap).toHaveBeenCalledTimes(2);
  });

  it("throws when any cluster fails instead of silently completing the stage", async () => {
    mockGetClustersForRun.mockResolvedValue([
      makeCluster(1),
      makeCluster(2),
    ]);

    mockClassifyGap
      .mockResolvedValueOnce({
        classification: "missing",
        priorityScore: 9,
        relatedGuideArticleId: null,
        similarityScore: null,
        justification: "No published article covers this topic.",
      })
      .mockRejectedValueOnce(
        new Error("AI classification failed")
      );

    await expect(
      runGapClassification(1, 100)
    ).rejects.toThrow(
      "Gap classification failed for 1 cluster(s)"
    );

    expect(mockGetTicketsByIds).toHaveBeenCalledTimes(2);

    expect(mockGetTicketsByIds).toHaveBeenNthCalledWith(
      1,
      [10],
      1
    );

    expect(mockGetTicketsByIds).toHaveBeenNthCalledWith(
      2,
      [20],
      1
    );

    // Promise.allSettled() still lets the successful cluster finish.
    expect(mockClassifyGap).toHaveBeenCalledTimes(2);

    expect(mockCreateKnowledgeGap).toHaveBeenCalledTimes(1);
  });
});