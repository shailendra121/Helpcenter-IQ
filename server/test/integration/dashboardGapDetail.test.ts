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

describe("HCIQ-15 dashboard gap detail API", () => {
  beforeEach(() => {
    process.env.ZAF_SESSION_SECRET =
      "test-secret-for-hciq-dashboard-auth-123456";

    vi.clearAllMocks();
  });

  it("rejects anonymous gap-detail access", async () => {
    const response = await request(app).get(
      "/api/dashboard/gaps/10",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-integer gap id", async () => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/gaps/abc")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Gap id must be an integer",
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the gap does not belong to the authenticated account", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/gaps/999")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "Knowledge gap 999 not found",
    );
  });

  it("returns gap detail with article, representative tickets, and recommendations", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            analysis_run_id: 33,
            cluster_id: 7,
            topic_summary: "Password reset",
            classification: "weak",
            estimated_ticket_volume: 42,
            priority_score: "9.20",
            related_guide_article_id: 55,
            related_guide_article_zendesk_id: "123456",
            related_guide_article_title:
              "Reset your password",
            related_guide_article_locale: "en-us",
            justification:
              "The existing article does not cover expired reset links.",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            zendesk_ticket_id: "9001",
            subject: "Password reset link expired",
            description:
              "The reset link no longer works.",
            status: "open",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 20,
            recommendation_type:
              "add_missing_steps",
            rationale:
              "Add troubleshooting steps for expired links.",
            suggested_keywords: [
              "password reset",
              "expired link",
            ],
            suggested_title:
              "Troubleshooting password reset links",
          },
        ],
        rowCount: 1,
      });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/gaps/10")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      id: 10,
      analysis_run_id: 33,
      cluster_id: 7,
      topic: "Password reset",
      classification: "weak",
      ticket_volume: 42,
      priority_score: "9.20",
      justification:
        "The existing article does not cover expired reset links.",
      matched_article_id: 55,
      matched_article_title:
        "Reset your password",
      matched_article_locale: "en-us",
      matched_article_url:
        "https://d3v-astonous.zendesk.com/hc/en-us/articles/123456",
    });

    expect(
      response.body.representative_tickets,
    ).toEqual([
      {
        id: 1,
        zendesk_ticket_id: "9001",
        subject: "Password reset link expired",
        description:
          "The reset link no longer works.",
        status: "open",
        zendesk_url:
          "https://d3v-astonous.zendesk.com/agent/tickets/9001",
      },
    ]);

    expect(response.body.recommendations).toEqual([
      {
        id: 20,
        recommendation_type:
          "add_missing_steps",
        rationale:
          "Add troubleshooting steps for expired links.",
        suggested_keywords: [
          "password reset",
          "expired link",
        ],
        suggested_title:
          "Troubleshooting password reset links",
      },
    ]);
  });

  it("returns empty arrays when a gap has no representative tickets or recommendations", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            analysis_run_id: 33,
            cluster_id: null,
            topic_summary: "New issue",
            classification: "missing",
            estimated_ticket_volume: 10,
            priority_score: "4.00",
            related_guide_article_id: null,
            related_guide_article_zendesk_id: null,
            related_guide_article_title: null,
            related_guide_article_locale: null,
            justification: "No matching article.",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/gaps/11")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body.representative_tickets).toEqual(
      [],
    );

    expect(response.body.recommendations).toEqual([]);
    expect(response.body.matched_article_url).toBeNull();
  });
});