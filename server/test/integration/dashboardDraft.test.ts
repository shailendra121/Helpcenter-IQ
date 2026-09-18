import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

const { mockGenerateDraftForGap } = vi.hoisted(() => ({
  mockGenerateDraftForGap: vi.fn(),
}));

vi.mock(
  "../../src/drafts/runDraftGeneration.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/drafts/runDraftGeneration.js")
      >();

    return {
      ...actual,
      generateDraftForGap:
        mockGenerateDraftForGap,
    };
  },
);

import app from "../../src/app.js";
import { createZafSessionToken } from "../../src/auth/zafSession.js";
import {
  KnowledgeGapMissingClusterError,
  KnowledgeGapNotFoundError,
} from "../../src/drafts/runDraftGeneration.js";

const TEST_APP_ORIGIN =
  "https://helpcenteriq.test";

describe("HCIQ-15 dashboard draft API", () => {
  beforeEach(() => {
    process.env.ZAF_SESSION_SECRET =
      "test-secret-for-hciq-dashboard-auth-123456";

    process.env.APP_ORIGIN =
      TEST_APP_ORIGIN;

    vi.clearAllMocks();
  });

  it("rejects anonymous draft generation", async () => {
    const response = await request(app).post(
      "/api/dashboard/gaps/10/drafts",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(
      mockGenerateDraftForGap,
    ).not.toHaveBeenCalled();
  });

  it("rejects authenticated draft generation when Origin is missing", async () => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/dashboard/gaps/10/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      "Trusted request origin required",
    );

    expect(
      mockGenerateDraftForGap,
    ).not.toHaveBeenCalled();
  });

  it("rejects authenticated draft generation from an untrusted Origin", async () => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/dashboard/gaps/10/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .set(
        "Origin",
        "https://attacker.example.com",
      );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      "Untrusted request origin",
    );

    expect(
      mockGenerateDraftForGap,
    ).not.toHaveBeenCalled();
  });

  it("rejects a non-integer gap id", async () => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/dashboard/gaps/abc/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .set("Origin", TEST_APP_ORIGIN);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Gap id must be an integer",
    );

    expect(
      mockGenerateDraftForGap,
    ).not.toHaveBeenCalled();
  });

  it("returns 404 when the gap is not found or belongs to another account", async () => {
    mockGenerateDraftForGap.mockRejectedValueOnce(
      new KnowledgeGapNotFoundError(999),
    );
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/dashboard/gaps/999/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .set("Origin", TEST_APP_ORIGIN);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "Knowledge gap 999 not found",
    );
  });

  it("returns 422 when the gap has no associated cluster", async () => {
    mockGenerateDraftForGap.mockRejectedValueOnce(
      new KnowledgeGapMissingClusterError(10),
     );
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/dashboard/gaps/10/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .set("Origin", TEST_APP_ORIGIN);

    expect(response.status).toBe(422);
    expect(response.body.error).toBe(
      "Knowledge gap 10 has no associated cluster",
    );
  });

  it("generates a draft for the authenticated account from the trusted application Origin", async () => {
    mockGenerateDraftForGap.mockResolvedValueOnce({
      draftId: 500,
    });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/dashboard/gaps/10/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .set("Origin", TEST_APP_ORIGIN);

    expect(response.status).toBe(201);

    expect(response.body).toEqual({
      id: 500,
      gap_id: 10,
    });

    expect(
      mockGenerateDraftForGap,
    ).toHaveBeenCalledWith(
      1,
      10,
    );
  });

  it("returns 500 for an unexpected draft-generation failure", async () => {
    mockGenerateDraftForGap.mockRejectedValueOnce(
      new Error("AI provider unavailable"),
    );

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .post("/api/dashboard/gaps/10/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .set("Origin", TEST_APP_ORIGIN);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(
      "Failed to generate draft",
    );
  });
});