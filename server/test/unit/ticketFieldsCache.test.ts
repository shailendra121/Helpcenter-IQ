import { beforeEach, describe, expect, it, vi } from "vitest";

// getValidAccessToken is called inside getCopilotFieldIds — stub it.
vi.mock("../../src/zendesk/getValidAccessToken.js", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));

import { getCopilotFieldIds } from "../../src/zendesk/ticketFieldsLookup.js";

function mockFieldsResponse() {
  return {
    ok: true,
    json: async () => ({
      ticket_fields: [
        { id: 101, type: "text", title: "Category" },
        { id: 102, type: "text", title: "Intent" },
        { id: 103, type: "text", title: "Sentiment" },
      ],
    }),
  } as unknown as Response;
}

describe("ticket-field cache (HCIQ-21: bounded + TTL)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("caches per subdomain — second call does not re-fetch within TTL", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(mockFieldsResponse());

    const sub = `acme-${Date.now()}`;
    const first = await getCopilotFieldIds(sub);
    const second = await getCopilotFieldIds(sub);

    expect(first.get("category")).toBe(101);
    expect(second.get("intent")).toBe(102);
    // One network call total — the second served from cache.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL expires", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(mockFieldsResponse());

    const sub = `ttl-${Date.now()}`;
    await getCopilotFieldIds(sub); // fetch 1
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance past the 10-minute TTL.
    vi.advanceTimersByTime(11 * 60 * 1000);

    await getCopilotFieldIds(sub); // fetch 2 (cache expired)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stays bounded — many distinct subdomains don't grow unbounded", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(mockFieldsResponse());

    // Fill well past the 500-entry bound.
    for (let i = 0; i < 600; i++) {
      await getCopilotFieldIds(`tenant-${i}`);
    }

    // The earliest subdomain should have been evicted, so it re-fetches.
    const callsBefore = fetchSpy.mock.calls.length;
    await getCopilotFieldIds("tenant-0");
    expect(fetchSpy.mock.calls.length).toBe(callsBefore + 1);
  });
});