import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEmbedTickets = vi.fn();
const mockGetDefaultClusteringConfig = vi.fn();
const mockClusterTicketsForRunSQL = vi.fn();
const mockGenerateClusterLabel = vi.fn();
const mockCreateTicketCluster = vi.fn();
const mockDeleteClustersForRun = vi.fn();
const mockGetTicketsByIds = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock("../../src/clustering/embedTickets.js", () => ({
  embedTickets: mockEmbedTickets,
}));

vi.mock("../../src/clustering/clusterTickets.js", () => ({
  getDefaultClusteringConfig: mockGetDefaultClusteringConfig,
}));

vi.mock("../../src/clustering/clusterTicketsSQL.js", () => ({
  clusterTicketsForRunSQL: mockClusterTicketsForRunSQL,
}));

vi.mock("../../src/clustering/generateClusterLabel.js", () => ({
  generateClusterLabel: mockGenerateClusterLabel,
}));

vi.mock("../../src/db/models/ticketClusters.js", () => ({
  createTicketCluster: mockCreateTicketCluster,
  deleteClustersForRun: mockDeleteClustersForRun,
}));

vi.mock("../../src/db/models/tickets.js", () => ({
  getTicketsByIds: mockGetTicketsByIds,
}));

vi.mock("../../src/db/pool.js", () => ({
  pool: {
    query: mockPoolQuery,
  },
}));

const { runClustering } = await import(
  "../../src/clustering/runClustering.js"
);

describe("runClustering", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockEmbedTickets.mockResolvedValue(undefined);
    mockDeleteClustersForRun.mockResolvedValue(undefined);

    mockGetDefaultClusteringConfig.mockReturnValue({
      similarityThreshold: 0.7,
      minClusterSize: 2,
    });

    mockClusterTicketsForRunSQL.mockResolvedValue({
      clusters: [
        {
          centroid: [0.1, 0.2, 0.3],
          memberTicketIds: [101, 102],
          memberVectors: [
            [0.1, 0.2, 0.3],
            [0.1, 0.21, 0.29],
          ],
        },
      ],
      unclusteredTicketIds: [103],
    });

    mockGetTicketsByIds.mockResolvedValue([
      {
        id: 101,
        subject: "Cannot reset password",
        description: "Password reset email never arrives.",
      },
      {
        id: 102,
        subject: "Password reset issue",
        description: "I cannot reset my password.",
      },
    ]);

    mockGenerateClusterLabel.mockResolvedValue({
      label: "Password Reset",
      summary: "Customers are having trouble resetting passwords.",
    });

    mockCreateTicketCluster.mockResolvedValue(undefined);

    mockPoolQuery.mockResolvedValue({
      rows: [],
    });
  });

  it("persists clusters and returns clustering counts when successful", async () => {
    const result = await runClustering(1, 100);

    expect(mockEmbedTickets).toHaveBeenCalledWith(1, 100);

    expect(mockDeleteClustersForRun).toHaveBeenCalledWith(
      1,
      100,
    );

    expect(mockClusterTicketsForRunSQL).toHaveBeenCalledWith(
      1,
      100,
      {
        similarityThreshold: 0.7,
        minClusterSize: 2,
      },
    );

    // Tenancy regression protection:
    // representative ticket lookup must stay scoped to the Zendesk account.
    expect(mockGetTicketsByIds).toHaveBeenCalledTimes(1);

    expect(mockGetTicketsByIds).toHaveBeenCalledWith(
      [101, 102],
      1,
    );

    expect(mockGenerateClusterLabel).toHaveBeenCalledTimes(1);

    expect(mockCreateTicketCluster).toHaveBeenCalledWith({
      zendeskAccountId: 1,
      analysisRunId: 100,
      topicLabel: "Password Reset",
      topicSummary:
        "Customers are having trouble resetting passwords.",
      centroidEmbedding: [0.1, 0.2, 0.3],
      memberTicketIds: [101, 102],
      memberVectors: [
        [0.1, 0.2, 0.3],
        [0.1, 0.21, 0.29],
      ],
      representativeTicketIds: [101, 102],
    });

    expect(result).toEqual({
      clustersCreated: 1,
      ticketsClustered: 2,
      ticketsUnclustered: 1,
    });
  });

  it("uses the fallback label and still persists the cluster when label generation fails", async () => {
    mockGenerateClusterLabel.mockRejectedValue(
      new Error("AI label generation failed"),
    );

    const result = await runClustering(1, 100);

    // Tenant scope must also remain present on the degraded path.
    expect(mockGetTicketsByIds).toHaveBeenCalledWith(
      [101, 102],
      1,
    );

    expect(mockCreateTicketCluster).toHaveBeenCalledWith(
      expect.objectContaining({
        zendeskAccountId: 1,
        analysisRunId: 100,
        topicLabel: "Unlabeled cluster",
        topicSummary: "",
      }),
    );

    expect(result.clustersCreated).toBe(1);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        1,
        "clustering_cluster_processing_failed",
      ]),
    );
  });

  it("throws when cluster persistence fails instead of silently completing the stage", async () => {
    mockCreateTicketCluster.mockRejectedValue(
      new Error("Database persistence failed"),
    );

    await expect(
      runClustering(1, 100),
    ).rejects.toThrow(
      "Clustering persistence failed for 1 cluster(s)",
    );

    // The representative ticket lookup still needs the account scope
    // before persistence is attempted.
    expect(mockGetTicketsByIds).toHaveBeenCalledWith(
      [101, 102],
      1,
    );

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        1,
        "clustering_cluster_processing_failed",
      ]),
    );
  });
});