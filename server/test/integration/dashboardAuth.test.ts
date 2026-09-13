import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../src/db/models/analysisRuns.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("../../src/db/models/analysisRuns.js")
    >("../../src/db/models/analysisRuns.js");

  return {
    ...actual,
    createQueuedRun: vi.fn(),
    getAnalysisRun: vi.fn(),
  };
});

import app from "../../src/app.js";
import {
  createQueuedRun,
  getAnalysisRun,
} from "../../src/db/models/analysisRuns.js";
import { createZafSessionToken } from "../../src/auth/zafSession.js";

const mockCreateQueuedRun = vi.mocked(createQueuedRun);
const mockGetAnalysisRun = vi.mocked(getAnalysisRun);

describe("HCIQ-15 analysis API authentication", () => {
  beforeEach(() => {
    process.env.ZAF_SESSION_SECRET =
      "test-secret-for-hciq-dashboard-auth-123456";

    vi.clearAllMocks();
  });

  it("rejects anonymous analysis-run creation", async () => {
    const response = await request(app)
      .post("/api/analysis-runs")
      .send({
        windowDays: 30,
        zendeskAccountId: 1,
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(mockCreateQueuedRun).not.toHaveBeenCalled();
  });

  it("rejects anonymous analysis-run status access", async () => {
    const response = await request(app).get(
      "/api/analysis-runs/1",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(mockGetAnalysisRun).not.toHaveBeenCalled();
  });

  it("uses the authenticated session account instead of a client-supplied account id", async () => {
    mockCreateQueuedRun.mockResolvedValue({
      id: 100,
      zendesk_account_id: 1,
      window_days: 30,
      status: "queued",
      current_stage: null,
      error_stage: null,
      error_message: null,
      started_at: null,
      completed_at: null,
      stage_timestamps: {},
      ingestion_cursor: null,
    });
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/analysis-runs")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .send({
        windowDays: 30,
        zendeskAccountId: 999,
      });

    expect(response.status).toBe(202);

    expect(mockCreateQueuedRun).toHaveBeenCalledWith(
      1,
      30,
    );

    expect(mockCreateQueuedRun).not.toHaveBeenCalledWith(
      999,
      30,
    );
  });

  it("does not allow an authenticated account to read another account's run", async () => {
    mockGetAnalysisRun.mockResolvedValue({
      id: 200,
      zendesk_account_id: 2,
      window_days: 30,
      status: "completed",
      current_stage: null,
      error_stage: null,
      error_message: null,
      started_at: new Date(),
      completed_at: new Date(),
      stage_timestamps: {},
      ingestion_cursor: null,
    });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/analysis-runs/200")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "Analysis run 200 not found",
    );
  });
});