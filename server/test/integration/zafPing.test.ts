import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

// New flow: verifyZafBearer looks up a per-account secret and decrypts it.
vi.mock("../../src/db/models/zendeskAccounts.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/db/models/zendeskAccounts.js")
  >("../../src/db/models/zendeskAccounts.js");
  return { ...actual, getAccountZafSecret: vi.fn() };
});
vi.mock("../../src/auth/tokenEncryption.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/auth/tokenEncryption.js")
  >("../../src/auth/tokenEncryption.js");
  return { ...actual, decryptToken: (s: string) => s };
});

import app from "../../src/app.js";
import { getAccountZafSecret } from "../../src/db/models/zendeskAccounts.js";

const SECRET = "test-zaf-jwt-secret-test-zaf-jwt-secret";

beforeEach(() => {
  vi.clearAllMocks();
  // this account's stored secret
  (getAccountZafSecret as any).mockResolvedValue(SECRET);
});

describe("GET /api/zaf/ping", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/zaf/ping");
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = jwt.sign(
      { subdomain: "acme" },
      "wrong-secret-wrong-secret-wrong-secret",
      { expiresIn: 300 },
    );
    const res = await request(app)
      .get("/api/zaf/ping")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("accepts a valid ZAF-signed token and returns the subdomain", async () => {
    const token = jwt.sign({ subdomain: "Acme" }, SECRET, { expiresIn: 300 });
    const res = await request(app)
      .get("/api/zaf/ping")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subdomain).toBe("acme");
  });
});