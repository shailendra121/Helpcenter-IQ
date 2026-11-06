import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../../src/db/models/zendeskAccounts.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/db/models/zendeskAccounts.js")
  >("../../src/db/models/zendeskAccounts.js");
  return {
    ...actual,
    findZendeskAccountBySubdomain: vi.fn(),
    getAccountZafSecret: vi.fn(),
  };
});
vi.mock("../../src/auth/tokenEncryption.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/auth/tokenEncryption.js")
  >("../../src/auth/tokenEncryption.js");
  return { ...actual, decryptToken: (s: string) => s };
});
vi.mock("../../src/db/models/analysisRuns.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/db/models/analysisRuns.js")
  >("../../src/db/models/analysisRuns.js");
  return {
    ...actual,
    createQueuedRun: vi.fn().mockResolvedValue({
      id: 1,
      window_days: 30,
      status: "queued",
      current_stage: null,
    }),
  };
});

import app from "../../src/app.js";
import {
  findZendeskAccountBySubdomain,
  getAccountZafSecret,
} from "../../src/db/models/zendeskAccounts.js";
import { createQueuedRun } from "../../src/db/models/analysisRuns.js";

const mockFindAccount = vi.mocked(findZendeskAccountBySubdomain);
const mockGetSecret = vi.mocked(getAccountZafSecret);
const mockCreateRun = vi.mocked(createQueuedRun);
const SECRET = "test-zaf-jwt-secret-test-zaf-jwt-secret";

function bearer(subdomain: string): string {
  return `Bearer ${jwt.sign({ subdomain }, SECRET, { expiresIn: 300 })}`;
}

describe("tenant comes only from the verified JWT (AC#2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecret.mockResolvedValue(SECRET as never);
    mockFindAccount.mockResolvedValue({ id: 7, subdomain: "acme" } as never);
  });

  it("ignores a spoofed subdomain in the query string", async () => {
    const res = await request(app)
      .get("/api/dashboard/session?subdomain=victim")
      .set("Authorization", bearer("acme")); // JWT says acme

    expect(res.status).toBe(200);
    // Account is looked up by the JWT's subdomain, never the query param.
    expect(mockFindAccount).toHaveBeenCalledWith("acme");
    expect(mockFindAccount).not.toHaveBeenCalledWith("victim");
  });

  it("ignores a spoofed zendeskAccountId in the request body", async () => {
    const res = await request(app)
      .post("/api/analysis-runs")
      .set("Authorization", bearer("acme")) // JWT → account id 7
      .send({ windowDays: 30, zendeskAccountId: 99999 }); // spoofed in body

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    // The run is created for the session account (7 from the JWT), NEVER 99999.
    expect(mockCreateRun).toHaveBeenCalledWith(7, 30);
    expect(mockCreateRun).not.toHaveBeenCalledWith(99999, expect.anything());
  });
});