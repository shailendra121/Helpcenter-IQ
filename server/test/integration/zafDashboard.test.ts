import "dotenv/config";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

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
    expect(res.text).toContain("Missing ZAF signature");
  });
});