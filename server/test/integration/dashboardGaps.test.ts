import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("../../src/db/pool.js", () => ({
  pool: {
    query: mockQuery,
  },
}));

import app from "../../src/app.js";
import { createZafSessionToken } from "../../src/auth/zafSession.js";

describe("HCIQ-15 dashboard gap API", () => {
  beforeEach(() => {
    process.env.ZAF_SESSION_SECRET =
      "test-secret-for-hciq-dashboard-auth-123456";

    vi.clearAllMocks();
  });

  it("rejects anonymous gap-list access", async () => {
    const response = await request(app).get(
      "/api/dashboard/gaps",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns empty state when the account has no completed run", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/gaps")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      run: null,
      gaps: [],
    });
  });

  it("returns gaps from the latest completed run", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 33 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            analysis_run_id: 33,
            topic_summary: "Password reset",
            classification: "missing",
            estimated_ticket_volume: 42,
            priority_score: "9.20",
            related_guide_article_id: null,
            guide_article_id: null,
            guide_article_title: null,
            guide_article_locale: null,
            justification: "No matching article exists.",
          },
        ],
        rowCount: 1,
      });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/gaps")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.run).toEqual({
      id: 33,
    });

    expect(response.body.gaps).toHaveLength(1);

    expect(response.body.gaps[0]).toMatchObject({
      id: 10,
      topic: "Password reset",
      classification: "missing",
      ticket_volume: 42,
      priority_score: "9.20",
      matched_article_id: null,
      matched_article_url: null,
    });
  });

  it("rejects an invalid classification filter", async () => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get(
        "/api/dashboard/gaps?classification=unknown",
      )
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid sort value", async () => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/gaps?sort=invalid")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});