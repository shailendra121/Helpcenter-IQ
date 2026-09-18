import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

vi.mock("../../src/db/models/analysisRuns.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("../../src/db/models/analysisRuns.js")
    >("../../src/db/models/analysisRuns.js");

  return {
    ...actual,
    getLatestRunForAccount: vi.fn(),
  };
});

import app from "../../src/app.js";
import { getLatestRunForAccount } from "../../src/db/models/analysisRuns.js";
import { createZafSessionToken } from "../../src/auth/zafSession.js";

const mockGetLatestRunForAccount = vi.mocked(
  getLatestRunForAccount,
);

describe("GET /api/analysis-runs/latest", () => {
  beforeEach(() => {
    process.env.ZAF_SESSION_SECRET =
      "test-secret-for-hciq-dashboard-auth-123456";

    vi.clearAllMocks();
  });

  it("rejects anonymous access", async () => {
    const response = await request(app).get(
      "/api/analysis-runs/latest",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(
      mockGetLatestRunForAccount,
    ).not.toHaveBeenCalled();
  });

  it("returns null when there is no previous run", async () => {
    mockGetLatestRunForAccount.mockResolvedValue(null);

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/analysis-runs/latest")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      run: null,
    });

    expect(
      mockGetLatestRunForAccount,
    ).toHaveBeenCalledWith(1);
  });

  it("returns the authenticated account's queued run", async () => {
    mockGetLatestRunForAccount.mockResolvedValue({
      id: 300,
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
      .get("/api/analysis-runs/latest")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body.run).toEqual({
      id: 300,
      window_days: 30,
      status: "queued",
      current_stage: null,
      error_stage: null,
      error_message: null,
      started_at: null,
      completed_at: null,
      stage_timestamps: {},
    });

    expect(
      mockGetLatestRunForAccount,
    ).toHaveBeenCalledWith(1);
  });

  it("returns the authenticated account's running run", async () => {
    mockGetLatestRunForAccount.mockResolvedValue({
      id: 301,
      zendesk_account_id: 1,
      window_days: 60,
      status: "running",
      current_stage: "clustering",
      error_stage: null,
      error_message: null,
      started_at: new Date(
        "2026-09-10T04:00:00.000Z",
      ),
      completed_at: null,
      stage_timestamps: {
        ticket_ingestion: {
          started_at:
            "2026-09-10T04:00:00.000Z",
          completed_at:
            "2026-09-10T04:01:00.000Z",
        },
      },
      ingestion_cursor: null,
    });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/analysis-runs/latest")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.run.id).toBe(301);
    expect(response.body.run.status).toBe(
      "running",
    );
    expect(
      response.body.run.current_stage,
    ).toBe("clustering");
    expect(response.body.run.window_days).toBe(
      60,
    );

    expect(
      mockGetLatestRunForAccount,
    ).toHaveBeenCalledWith(1);
  });

  it("returns a failed run with its failure details after reload", async () => {
    mockGetLatestRunForAccount.mockResolvedValue({
      id: 302,
      zendesk_account_id: 1,
      window_days: 90,
      status: "failed",
      current_stage: "classification",
      error_stage: "classification",
      error_message: "AI classification failed",
      started_at: new Date(
        "2026-09-10T04:00:00.000Z",
      ),
      completed_at: null,
      stage_timestamps: {
        ticket_ingestion: {
          started_at:
            "2026-09-10T04:00:00.000Z",
          completed_at:
            "2026-09-10T04:01:00.000Z",
        },
        guide_ingestion: {
          started_at:
            "2026-09-10T04:01:00.000Z",
          completed_at:
            "2026-09-10T04:02:00.000Z",
        },
        clustering: {
          started_at:
            "2026-09-10T04:02:00.000Z",
          completed_at:
            "2026-09-10T04:03:00.000Z",
        },
        classification: {
          started_at:
            "2026-09-10T04:03:00.000Z",
        },
      },
      ingestion_cursor: null,
    });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/analysis-runs/latest")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body.run).toMatchObject({
      id: 302,
      window_days: 90,
      status: "failed",
      current_stage: "classification",
      error_stage: "classification",
      error_message: "AI classification failed",
    });

    expect(
      response.body.run.stage_timestamps.classification,
    ).toEqual({
      started_at:
        "2026-09-10T04:03:00.000Z",
    });

    expect(
      mockGetLatestRunForAccount,
    ).toHaveBeenCalledWith(1);
  });

  it("uses only the authenticated account id", async () => {
    mockGetLatestRunForAccount.mockResolvedValue(null);

    const sessionToken = createZafSessionToken(
      7,
      "another-subdomain",
    );

    const response = await request(app)
      .get("/api/analysis-runs/latest")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);

    expect(
      mockGetLatestRunForAccount,
    ).toHaveBeenCalledWith(7);
  });
});