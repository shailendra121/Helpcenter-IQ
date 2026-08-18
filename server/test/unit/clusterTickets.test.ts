import { describe, it, expect } from "vitest";
import { clusterEmbeddings } from "../../src/clustering/clusterTickets.js";

// Helper to build simple, human-readable test vectors. Real embeddings
// are 1536-dim, but the algorithm is dimension-agnostic — small vectors
// make the test cases easy to reason about.
function vec(...values: number[]): number[] {
  return values;
}

describe("clusterEmbeddings", () => {
  it("groups similar tickets into the same cluster", () => {
    const tickets = [
      { id: 1, vector: vec(1, 0, 0) },
      { id: 2, vector: vec(0.99, 0.01, 0) }, // nearly identical to ticket 1
      { id: 3, vector: vec(0.98, 0.02, 0) }, // also close to ticket 1
    ];

    const result = clusterEmbeddings(tickets, {
      similarityThreshold: 0.9,
      minClusterSize: 2,
    });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].memberTicketIds.sort()).toEqual([1, 2, 3]);
    expect(result.unclusteredTicketIds).toHaveLength(0);
  });

  it("separates dissimilar tickets into different clusters", () => {
    const tickets = [
      { id: 1, vector: vec(1, 0, 0) },
      { id: 2, vector: vec(0.99, 0.01, 0) },
      { id: 3, vector: vec(0, 1, 0) },
      { id: 4, vector: vec(0.01, 0.99, 0) },
    ];

    const result = clusterEmbeddings(tickets, {
      similarityThreshold: 0.9,
      minClusterSize: 2,
    });

    expect(result.clusters).toHaveLength(2);
    const clusterSizes = result.clusters.map((c) => c.memberTicketIds.length).sort();
    expect(clusterSizes).toEqual([2, 2]);
  });

  it("moves clusters smaller than minClusterSize to the unclustered bucket", () => {
    const tickets = [
      { id: 1, vector: vec(1, 0, 0) },
      { id: 2, vector: vec(0.99, 0.01, 0) },
      { id: 3, vector: vec(0, 0, 1) }, // singleton — very different direction
    ];

    const result = clusterEmbeddings(tickets, {
      similarityThreshold: 0.9,
      minClusterSize: 2,
    });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].memberTicketIds.sort()).toEqual([1, 2]);
    expect(result.unclusteredTicketIds).toEqual([3]);
  });

  it("respects the configured similarity threshold", () => {
    const tickets = [
      { id: 1, vector: vec(1, 0, 0) },
      { id: 2, vector: vec(0.7, 0.3, 0) }, // moderately similar
    ];

    // Strict threshold — should NOT merge.
    const strictResult = clusterEmbeddings(tickets, {
      similarityThreshold: 0.99,
      minClusterSize: 1,
    });
    expect(strictResult.clusters.length).toBeGreaterThanOrEqual(1);
    expect(strictResult.clusters.every((c) => c.memberTicketIds.length === 1)).toBe(true);

    // Loose threshold — should merge.
    const looseResult = clusterEmbeddings(tickets, {
      similarityThreshold: 0.7,
      minClusterSize: 1,
    });
    expect(looseResult.clusters).toHaveLength(1);
    expect(looseResult.clusters[0].memberTicketIds).toHaveLength(2);
  });

  it("returns an empty result for no tickets", () => {
    const result = clusterEmbeddings([], { similarityThreshold: 0.8, minClusterSize: 2 });
    expect(result.clusters).toHaveLength(0);
    expect(result.unclusteredTicketIds).toHaveLength(0);
  });
});