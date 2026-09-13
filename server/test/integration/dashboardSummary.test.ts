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

describe("HCIQ-15 dashboard summary API", () => {
  beforeEach(() => {
    process.env.ZAF_SESSION_SECRET =
      "test-secret-for-hciq-dashboard-auth-123456";

    vi.clearAllMocks();
  });

  it("rejects anonymous summary access", async () => {
    const response = await request(app).get(
      "/api/dashboard/summary",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns an empty state when there is no completed run", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/summary")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      run: null,
      summary: null,
    });
  });

  it("returns all dashboard summary sections for the latest completed run", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 33 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            estimated_ticket_volume: "100",
            articles_needing_updates: "3",
            potential_deflection_estimate: "85",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            topic_summary: "Password reset",
            estimated_ticket_volume: 42,
            priority_score: "9.20",
            related_guide_article_id: null,
            guide_article_title: null,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            topic_summary: "Login issues",
            estimated_ticket_volume: 58,
            classification: "weak",
          },
        ],
        rowCount: 1,
      });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/summary")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.run).toEqual({
      id: 33,
    });

    expect(response.body.summary).toMatchObject({
      estimated_ticket_volume: 100,
      articles_needing_updates: 3,
      potential_deflection_estimate: 85,
      potential_deflection_label:
        "Estimated potential deflection (volume-based)",
      methodology:
        "Sum of estimated ticket volume for Missing, Weak, and Outdated gaps.",
    });

    expect(response.body.summary.top_missing_articles).toEqual([
      {
        id: 10,
        topic: "Password reset",
        ticket_volume: 42,
        priority_score: "9.20",
        matched_article_id: null,
        matched_article_title: null,
      },
    ]);

    expect(
      response.body.summary.most_repeated_questions,
    ).toEqual([
      {
        id: 11,
        topic: "Login issues",
        ticket_volume: 58,
        classification: "weak",
      },
    ]);
  });
});