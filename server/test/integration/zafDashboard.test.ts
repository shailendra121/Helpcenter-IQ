import "dotenv/config";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
} from "vitest";
import request from "supertest";

import { pool } from "../../src/db/pool.js";
import { upsertZendeskAccount } from "../../src/db/models/zendeskAccounts.js";

// Mock fs so this test doesn't depend on a real public key file existing
// on disk (won't exist in CI) — we only care that middleware order lets
// req.body.token through, not real JWT validity here.
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue("dummy-public-key-content"),
  },
}));

process.env.ZAF_APP_PUBLIC_KEY_PATH =
  process.env.ZAF_APP_PUBLIC_KEY_PATH ?? "./fake-path-for-tests.pem";

const { default: app } = await import("../../src/app.js");

describe("POST /zaf/dashboard", () => {
  it("reads the token from urlencoded form body (not undefined)", async () => {
    const res = await request(app)
      .post("/zaf/dashboard")
      .type("form")
      .send({ token: "not-a-real-jwt" });

    // We're not testing JWT validity here — just that req.body.token was
    // actually populated (proves urlencoded middleware ran before this
    // route). If middleware order were wrong, req.body.token would be
    // undefined and we'd get "Missing ZAF signature". Instead, since the
    // token WAS read, verification proceeds and fails on signature
    // validity ("Invalid signature") — proving the body was parsed.
    expect(res.status).toBe(401);
    expect(res.text).not.toContain("Missing ZAF signature");
    expect(res.text).toContain("Invalid signature");
  });

  it("rejects when no token is sent at all (sanity check for the negative case)", async () => {
    const res = await request(app).post("/zaf/dashboard").type("form").send({});

    expect(res.status).toBe(401);
    expect(res.text).toContain(
      "Missing ZAF signature",
    );
  });
});

describe("GET /zaf/dashboard", () => {
  let accountId: number;
  let subdomain: string;

  beforeAll(async () => {
    subdomain = `test-zaf-dashboard-${Date.now()}`;

    const account = await upsertZendeskAccount({
      subdomain,
      accessTokenEncrypted: "fake-encrypted-token",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(
        Date.now() + 3600 * 1000,
      ),
    });

    accountId = account.id;
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM zendesk_accounts WHERE id = $1",
      [accountId],
    );
  });

  it("does not mint an authenticated session for an unverified GET request, even for an installed tenant in development", async () => {
    const previousNodeEnv = process.env.NODE_ENV;

    process.env.NODE_ENV = "development";

    try {
      const res = await request(app)
        .get("/zaf/dashboard")
        .query({ origin: subdomain });

      expect(res.status).toBe(200);

      const setCookie = res.headers["set-cookie"];

      expect(setCookie).toBeUndefined();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("rejects when origin is missing", async () => {
    const res = await request(app).get(
      "/zaf/dashboard",
    );

    expect(res.status).toBe(400);
    expect(res.text).toContain(
      "Missing origin parameter",
    );
  });
});