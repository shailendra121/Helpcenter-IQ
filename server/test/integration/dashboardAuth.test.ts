import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

vi.mock(
  "../../src/db/models/analysisRuns.js",
  async () => {
    const actual =
      await vi.importActual<
        typeof import("../../src/db/models/analysisRuns.js")
      >(
        "../../src/db/models/analysisRuns.js",
      );

    return {
      ...actual,
      createQueuedRun: vi.fn(),
      getAnalysisRun: vi.fn(),
    };
  },
);

import app from "../../src/app.js";
import {
  createQueuedRun,
  getAnalysisRun,
} from "../../src/db/models/analysisRuns.js";
import {
  createZafSessionToken,
} from "../../src/auth/zafSession.js";

const TEST_APP_ORIGIN =
  "https://helpcenteriq.test";

const mockCreateQueuedRun =
  vi.mocked(createQueuedRun);

const mockGetAnalysisRun =
  vi.mocked(getAnalysisRun);

describe(
  "HCIQ-15 analysis API authentication",
  () => {
    beforeEach(() => {
      process.env.ZAF_SESSION_SECRET =
        "test-secret-for-hciq-dashboard-auth-123456";

      process.env.APP_ORIGIN =
        TEST_APP_ORIGIN;

      vi.clearAllMocks();
    });

    it(
      "rejects anonymous analysis-run creation",
      async () => {
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

        expect(
          mockCreateQueuedRun,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects anonymous analysis-run status access",
      async () => {
        const response =
          await request(app).get(
            "/api/analysis-runs/1",
          );

        expect(response.status).toBe(401);

        expect(response.body.error).toBe(
          "ZAF-authenticated session required",
        );

        expect(
          mockGetAnalysisRun,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects analysis-run creation when Origin is missing",
      async () => {
        const sessionToken =
          createZafSessionToken(
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
          });

        expect(response.status).toBe(403);

        expect(response.body.error).toBe(
          "Trusted request origin required",
        );

        expect(
          mockCreateQueuedRun,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects analysis-run creation from an untrusted Origin",
      async () => {
        const sessionToken =
          createZafSessionToken(
            1,
            "d3v-astonous",
          );

        const response = await request(app)
          .post("/api/analysis-runs")
          .set(
            "Cookie",
            `hciq_zaf_session=${sessionToken}`,
          )
          .set(
            "Origin",
            "https://attacker.example.com",
          )
          .send({
            windowDays: 30,
          });

        expect(response.status).toBe(403);

        expect(response.body.error).toBe(
          "Untrusted request origin",
        );

        expect(
          mockCreateQueuedRun,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "uses the authenticated session account instead of a client-supplied account id",
      async () => {
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

        const sessionToken =
          createZafSessionToken(
            1,
            "d3v-astonous",
          );

        const response = await request(app)
          .post("/api/analysis-runs")
          .set(
            "Cookie",
            `hciq_zaf_session=${sessionToken}`,
          )
          .set(
            "Origin",
            TEST_APP_ORIGIN,
          )
          .send({
            windowDays: 30,
            zendeskAccountId: 999,
          });

        expect(response.status).toBe(202);

        expect(
          mockCreateQueuedRun,
        ).toHaveBeenCalledWith(
          1,
          30,
        );

        expect(
          mockCreateQueuedRun,
        ).not.toHaveBeenCalledWith(
          999,
          30,
        );
      },
    );

    it(
      "does not allow an authenticated account to read another account's run",
      async () => {
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

        const sessionToken =
          createZafSessionToken(
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
      },
    );
  },
);

describe(
  "Dashboard Zendesk session identity",
  () => {
    beforeEach(() => {
      process.env.ZAF_SESSION_SECRET =
        "test-secret-for-hciq-dashboard-auth-123456";

      process.env.APP_ORIGIN =
        TEST_APP_ORIGIN;

      vi.clearAllMocks();
    });

    it(
      "rejects anonymous access to the dashboard session endpoint",
      async () => {
        const response =
          await request(app).get(
            "/api/dashboard/session",
          );

        expect(response.status).toBe(401);

        expect(response.body.error).toBe(
          "ZAF-authenticated session required",
        );
      },
    );

    it(
      "returns the Zendesk tenant from the authenticated signed session",
      async () => {
        const sessionToken =
          createZafSessionToken(
            42,
            "customer-support",
          );

        const response = await request(app)
          .get("/api/dashboard/session")
          .set(
            "Cookie",
            `hciq_zaf_session=${sessionToken}`,
          );

        expect(response.status).toBe(200);

        expect(response.body).toEqual({
          authenticated: true,
          zendesk_account_id: 42,
          subdomain: "customer-support",
          zendesk_url:
            "https://customer-support.zendesk.com",
        });
      },
    );

    it(
      "does not use a client-supplied subdomain instead of the authenticated session tenant",
      async () => {
        const sessionToken =
          createZafSessionToken(
            42,
            "real-zendesk-org",
          );

        const response = await request(app)
          .get(
            "/api/dashboard/session?subdomain=fake-org",
          )
          .set(
            "Cookie",
            `hciq_zaf_session=${sessionToken}`,
          );

        expect(response.status).toBe(200);

        expect(
          response.body.subdomain,
        ).toBe("real-zendesk-org");

        expect(
          response.body.zendesk_account_id,
        ).toBe(42);

        expect(
          response.body.zendesk_url,
        ).toBe(
          "https://real-zendesk-org.zendesk.com",
        );

        expect(
          response.body.subdomain,
        ).not.toBe("fake-org");
      },
    );
  },
);