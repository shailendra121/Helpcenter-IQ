import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "helpcenteriq-server" });
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("helpcenteriq-server");
  });
});