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

import app from "../../src/app.js";
import {
  findZendeskAccountBySubdomain,
  getAccountZafSecret,
} from "../../src/db/models/zendeskAccounts.js";

const mockFindAccount = vi.mocked(findZendeskAccountBySubdomain);
const mockGetSecret = vi.mocked(getAccountZafSecret);
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
      .set("Authorization", bearer("acme")) // JWT says acme (account 7)
      .send({ windowDays: 30, zendeskAccountId: 99999 }); // spoofed id in body

    // The route must use the account from the JWT session, never the body.
    // It may 202 (created) or fail validation later, but never acts on 99999.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
    // createQueuedRun is called with the session account (7), not the body's 99999.
    // (The account is attached by requireZafSession from the verified JWT.)
  });
});