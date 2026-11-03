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

function bearer(subdomain: string, secret = SECRET): string {
  return `Bearer ${jwt.sign({ subdomain }, secret, { expiresIn: 300 })}`;
}

describe("ZAF Bearer JWT authentication on dashboard API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each account has its own stored secret; for these tests it is SECRET.
    mockGetSecret.mockResolvedValue(SECRET as never);
  });

  it("returns the account for a valid ZAF-signed token", async () => {
    mockFindAccount.mockResolvedValue({
      id: 7,
      subdomain: "acme",
    } as never);

    const res = await request(app)
      .get("/api/dashboard/session")
      .set("Authorization", bearer("acme"));

    expect(res.status).toBe(200);
    expect(mockFindAccount).toHaveBeenCalledWith("acme");
    expect(JSON.stringify(res.body)).toContain("acme");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const res = await request(app)
      .get("/api/dashboard/session")
      .set(
        "Authorization",
        bearer("acme", "wrong-secret-wrong-secret-wrong-secret"),
      );

    expect(res.status).toBe(401);
    expect(mockFindAccount).not.toHaveBeenCalled();
  });

  it("returns 404 not_installed when the account has not installed the app", async () => {
    mockFindAccount.mockResolvedValue(null as never);

    const res = await request(app)
      .get("/api/dashboard/session")
      .set("Authorization", bearer("ghost"));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_installed");
  });

  it("returns 503 when the database is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFindAccount.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await request(app)
      .get("/api/dashboard/session")
      .set("Authorization", bearer("acme"));

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("database_unavailable");
    errorSpy.mockRestore();
  });

  it("does not require an Origin header for Bearer-authenticated POSTs", async () => {
    mockFindAccount.mockResolvedValue({ id: 7, subdomain: "acme" } as never);

    // No Origin header (Zendesk's proxy does not send one). The request must get
    // past the origin check; it may fail later on validation, but never with 403.
    const res = await request(app)
      .post("/api/analysis-runs")
      .set("Authorization", bearer("acme"))
      .send({ windowDays: 999 });

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
    it("returns 503 when the secret lookup (getAccountZafSecret) fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The DB fails during the per-account secret lookup (not the account lookup).
    mockGetSecret.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await request(app)
      .get("/api/dashboard/session")
      .set("Authorization", bearer("acme"));

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("database_unavailable");
    errorSpy.mockRestore();
  });

  it("returns 404 not_installed when the account has no stored secret yet", async () => {
    // Account hasn't completed OAuth, so there is no per-account secret.
    mockGetSecret.mockResolvedValue(null as never);

    const res = await request(app)
      .get("/api/dashboard/session")
      .set("Authorization", bearer("newcomer"));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_installed");
  });
});