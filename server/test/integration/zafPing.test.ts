import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/app";

const SECRET = "test-zaf-jwt-secret-test-zaf-jwt-secret";

beforeAll(() => {
  process.env.ZAF_JWT_SECRET = SECRET;
});

describe("GET /api/zaf/ping", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/zaf/ping");
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = jwt.sign({ subdomain: "acme" }, "wrong-secret-wrong-secret-wrong-secret", {
      expiresIn: 300,
    });
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