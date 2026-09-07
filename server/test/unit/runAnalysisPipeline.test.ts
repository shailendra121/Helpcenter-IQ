import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAnalysisPipeline } from "../../src/jobs/runAnalysisPipeline.js";

import {
  ANALYSIS_STAGES,
  completeAnalysisRun,
  completeAnalysisStage,
  failRunAtStage,
  getAnalysisRun,
  startAnalysisStage,
} from "../../src/db/models/analysisRuns.js";

import { findZendeskAccountById } from "../../src/db/models/zendeskAccounts.js";

import { ingestTickets } from "../../src/zendesk/ingestTickets.js";
import { ingestGuideArticles } from "../../src/zendesk/ingestGuideArticles.js";
import { runClustering } from "../../src/clustering/runClustering.js";
import { runGapClassification } from "../../src/classification/runGapClassification.js";
import { runRecommendationGeneration } from "../../src/recommendations/runRecommendationGeneration.js";

vi.mock("../../src/db/models/analysisRuns.js", () => ({
  ANALYSIS_STAGES: [
    "ticket_ingestion",
    "guide_ingestion",
    "clustering",
    "classification",
    "recommendation",
  ],

  completeAnalysisRun: vi.fn(),
  completeAnalysisStage: vi.fn(),
  failRunAtStage: vi.fn(),
  getAnalysisRun: vi.fn(),
  startAnalysisStage: vi.fn(),
}));

vi.mock("../../src/db/models/zendeskAccounts.js", () => ({
  findZendeskAccountById: vi.fn(),
}));

vi.mock("../../src/zendesk/ingestTickets.js", () => ({
  ingestTickets: vi.fn(),
}));

vi.mock("../../src/zendesk/ingestGuideArticles.js", () => ({
  ingestGuideArticles: vi.fn(),
}));

vi.mock("../../src/clustering/runClustering.js", () => ({
  runClustering: vi.fn(),
}));

vi.mock("../../src/classification/runGapClassification.js", () => ({
  runGapClassification: vi.fn(),
}));

vi.mock("../../src/recommendations/runRecommendationGeneration.js", () => ({
  runRecommendationGeneration: vi.fn(),
}));

const mockedGetAnalysisRun = vi.mocked(getAnalysisRun);
const mockedFindZendeskAccountById = vi.mocked(findZendeskAccountById);

const mockedStartAnalysisStage = vi.mocked(startAnalysisStage);
const mockedCompleteAnalysisStage = vi.mocked(completeAnalysisStage);
const mockedFailRunAtStage = vi.mocked(failRunAtStage);
const mockedCompleteAnalysisRun = vi.mocked(completeAnalysisRun);

const mockedIngestTickets = vi.mocked(ingestTickets);
const mockedIngestGuideArticles = vi.mocked(ingestGuideArticles);
const mockedRunClustering = vi.mocked(runClustering);
const mockedRunGapClassification = vi.mocked(runGapClassification);
const mockedRunRecommendationGeneration = vi.mocked(
  runRecommendationGeneration,
);

function makeRun(
  overrides: Partial<Awaited<ReturnType<typeof getAnalysisRun>>> = {},
) {
  return {
    id: 42,
    zendesk_account_id: 1,
    window_days: 30,
    status: "running" as const,
    started_at: new Date(),
    completed_at: null,
    ingestion_cursor: null,
    current_stage: null,
    error_stage: null,
    error_message: null,
    stage_timestamps: {},
    ...overrides,
  };
}

describe("runAnalysisPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedFindZendeskAccountById.mockResolvedValue({
      id: 1,
      subdomain: "test-account",
      oauth_access_token_encrypted: "encrypted-access-token",
      oauth_refresh_token_encrypted: null,
      oauth_scope: null,
      oauth_expires_at: null,
      installed_at: new Date(),
    });

    mockedStartAnalysisStage.mockResolvedValue(undefined);
    mockedCompleteAnalysisStage.mockResolvedValue(undefined);
    mockedCompleteAnalysisRun.mockResolvedValue(undefined);
    mockedFailRunAtStage.mockResolvedValue(undefined);

    mockedIngestTickets.mockResolvedValue({
      runId: 42,
      ticketCount: 10,
    });

    mockedIngestGuideArticles.mockResolvedValue({
      articlesSeen: 5,
      articlesEmbedded: 3,
      articlesSkipped: 2,
    });

    mockedRunClustering.mockResolvedValue({
      clustersCreated: 2,
      ticketsClustered: 10,
      ticketsUnclustered: 0,
    });

    mockedRunGapClassification.mockResolvedValue({
      gapsCreated: 2,
    });

    mockedRunRecommendationGeneration.mockResolvedValue({
      recommendationsCreated: 2,
    });
  });

  it("runs all five stages in the correct order", async () => {
    mockedGetAnalysisRun.mockResolvedValue(makeRun());

    const calls: string[] = [];

    mockedStartAnalysisStage.mockImplementation(async (_runId, stage) => {
      calls.push(`start:${stage}`);
    });

    mockedCompleteAnalysisStage.mockImplementation(async (_runId, stage) => {
      calls.push(`complete:${stage}`);
    });

    mockedIngestTickets.mockImplementation(async () => {
      calls.push("execute:ticket_ingestion");

      return {
        runId: 42,
        ticketCount: 10,
      };
    });

    mockedIngestGuideArticles.mockImplementation(async () => {
      calls.push("execute:guide_ingestion");

      return {
        articlesSeen: 5,
        articlesEmbedded: 3,
        articlesSkipped: 2,
      };
    });

    mockedRunClustering.mockImplementation(async () => {
      calls.push("execute:clustering");

      return {
        clustersCreated: 2,
        ticketsClustered: 10,
        ticketsUnclustered: 0,
      };
    });

    mockedRunGapClassification.mockImplementation(async () => {
      calls.push("execute:classification");

      return {
        gapsCreated: 2,
      };
    });

    mockedRunRecommendationGeneration.mockImplementation(async () => {
      calls.push("execute:recommendation");

      return {
        recommendationsCreated: 2,
      };
    });

    await runAnalysisPipeline(42);

    expect(calls).toEqual([
      "start:ticket_ingestion",
      "execute:ticket_ingestion",
      "complete:ticket_ingestion",

      "start:guide_ingestion",
      "execute:guide_ingestion",
      "complete:guide_ingestion",

      "start:clustering",
      "execute:clustering",
      "complete:clustering",

      "start:classification",
      "execute:classification",
      "complete:classification",

      "start:recommendation",
      "execute:recommendation",
      "complete:recommendation",
    ]);

    expect(mockedCompleteAnalysisRun).toHaveBeenCalledWith(42);
  });

  it("throws when the analysis run does not exist", async () => {
    mockedGetAnalysisRun.mockResolvedValue(null);

    await expect(runAnalysisPipeline(42)).rejects.toThrow(
      "Analysis run 42 not found",
    );

    expect(mockedFindZendeskAccountById).not.toHaveBeenCalled();
    expect(mockedStartAnalysisStage).not.toHaveBeenCalled();
  });

  it("throws when the Zendesk account does not exist", async () => {
    mockedGetAnalysisRun.mockResolvedValue(makeRun());
    mockedFindZendeskAccountById.mockResolvedValue(null);

    await expect(runAnalysisPipeline(42)).rejects.toThrow(
      "Zendesk account 1 not found",
    );

    expect(mockedStartAnalysisStage).not.toHaveBeenCalled();
  });

  it("skips stages that were already completed", async () => {
    mockedGetAnalysisRun.mockResolvedValue(
      makeRun({
        stage_timestamps: {
          ticket_ingestion: {
            started_at: "2026-09-03T08:00:00Z",
            completed_at: "2026-09-03T08:01:00Z",
          },
          guide_ingestion: {
            started_at: "2026-09-03T08:01:00Z",
            completed_at: "2026-09-03T08:02:00Z",
          },
          clustering: {
            started_at: "2026-09-03T08:02:00Z",
            completed_at: "2026-09-03T08:03:00Z",
          },
        },
      }),
    );

    await runAnalysisPipeline(42);

    expect(mockedIngestTickets).not.toHaveBeenCalled();
    expect(mockedIngestGuideArticles).not.toHaveBeenCalled();
    expect(mockedRunClustering).not.toHaveBeenCalled();

    expect(mockedRunGapClassification).toHaveBeenCalledWith(1, 42);
    expect(mockedRunRecommendationGeneration).toHaveBeenCalledWith(1, 42);

    expect(mockedStartAnalysisStage).toHaveBeenCalledTimes(2);
    expect(mockedCompleteAnalysisStage).toHaveBeenCalledTimes(2);

    expect(mockedCompleteAnalysisRun).toHaveBeenCalledWith(42);
  });

  it("records a stage failure and does not continue to later stages", async () => {
    mockedGetAnalysisRun.mockResolvedValue(makeRun());

    const failure = new Error("classification failed");

    mockedRunGapClassification.mockRejectedValue(failure);

    await expect(runAnalysisPipeline(42)).rejects.toThrow(
      "classification failed",
    );

    expect(mockedRunGapClassification).toHaveBeenCalledWith(1, 42);

    expect(mockedFailRunAtStage).toHaveBeenCalledWith(
      42,
      "classification",
      failure,
    );

    expect(mockedRunRecommendationGeneration).not.toHaveBeenCalled();

    expect(mockedCompleteAnalysisRun).not.toHaveBeenCalled();
  });

  it("starts and completes each stage around the stage execution", async () => {
    mockedGetAnalysisRun.mockResolvedValue(makeRun());

    const events: string[] = [];

    mockedStartAnalysisStage.mockImplementation(async (_runId, stage) => {
      events.push(`start:${stage}`);
    });

    mockedCompleteAnalysisStage.mockImplementation(async (_runId, stage) => {
      events.push(`complete:${stage}`);
    });

    mockedRunClustering.mockImplementation(async () => {
      events.push("execute:clustering");

      return {
        clustersCreated: 1,
        ticketsClustered: 5,
        ticketsUnclustered: 0,
      };
    });

    await runAnalysisPipeline(42);

    const clusteringStart = events.indexOf("start:clustering");
    const clusteringExecute = events.indexOf("execute:clustering");
    const clusteringComplete = events.indexOf("complete:clustering");

    expect(clusteringStart).toBeLessThan(clusteringExecute);
    expect(clusteringExecute).toBeLessThan(clusteringComplete);
  });

  it("passes the analysis run id to the ticket stage so cursor-based resume is possible", async () => {
    mockedGetAnalysisRun.mockResolvedValue(
      makeRun({
        ingestion_cursor: "cursor-123",
      }),
    );

    await runAnalysisPipeline(42);

    expect(mockedIngestTickets).toHaveBeenCalledWith(
      1,
      "test-account",
      30,
      42,
    );
  });

  it("passes the account subdomain to Zendesk ingestion stages", async () => {
    mockedGetAnalysisRun.mockResolvedValue(makeRun());

    await runAnalysisPipeline(42);

    expect(mockedIngestTickets).toHaveBeenCalledWith(
      1,
      "test-account",
      30,
      42,
    );

    expect(mockedIngestGuideArticles).toHaveBeenCalledWith(
      1,
      "test-account",
    );
  });

  it("does not complete the overall run when a stage fails", async () => {
    mockedGetAnalysisRun.mockResolvedValue(makeRun());

    mockedRunClustering.mockRejectedValue(
      new Error("clustering failed"),
    );

    await expect(runAnalysisPipeline(42)).rejects.toThrow(
      "clustering failed",
    );

    expect(mockedCompleteAnalysisStage).toHaveBeenCalledTimes(2);
    expect(mockedFailRunAtStage).toHaveBeenCalledTimes(1);
    expect(mockedCompleteAnalysisRun).not.toHaveBeenCalled();
  });

  it("runs every declared analysis stage exactly once for a fresh run", async () => {
    mockedGetAnalysisRun.mockResolvedValue(makeRun());

    await runAnalysisPipeline(42);

    expect(mockedStartAnalysisStage).toHaveBeenCalledTimes(
      ANALYSIS_STAGES.length,
    );

    expect(mockedCompleteAnalysisStage).toHaveBeenCalledTimes(
      ANALYSIS_STAGES.length,
    );

    for (const stage of ANALYSIS_STAGES) {
      expect(mockedStartAnalysisStage).toHaveBeenCalledWith(
        42,
        stage,
      );

      expect(mockedCompleteAnalysisStage).toHaveBeenCalledWith(
        42,
        stage,
      );
    }
  });
});