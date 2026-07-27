import "dotenv/config";
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

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