import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

describe("no reflected XSS in server-rendered HTML (AC#4)", () => {
  it("does not reflect a malicious subdomain into the OAuth start response", async () => {
    const res = await request(app).get(
      "/zendesk/oauth/start?subdomain=<script>alert(1)</script>",
    );

    // Invalid subdomain is rejected by validation; the payload is never
    // echoed back into HTML.
    expect(res.text).not.toContain("<script>alert(1)</script>");
  });
});