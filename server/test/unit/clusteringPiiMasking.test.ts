import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmbed = vi.fn();
const mockGenerateText = vi.fn();
vi.mock("../../src/ai/providers/index.js", () => ({
  createAIProvider: () => ({ embed: mockEmbed, generateText: mockGenerateText }),
}));

const mockGetTicketsNeedingEmbedding = vi.fn();
const mockUpdateTicketEmbedding = vi.fn();
vi.mock("../../src/db/models/tickets.js", () => ({
  getTicketsNeedingEmbedding: mockGetTicketsNeedingEmbedding,
  updateTicketEmbedding: mockUpdateTicketEmbedding,
}));

const { embedTickets } = await import("../../src/clustering/embedTickets.js");
const { generateClusterLabel } = await import("../../src/clustering/generateClusterLabel.js");

describe("PII masking in the clustering pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue({ vector: Array(1536).fill(0.1), model: "gemini-embedding-001" });
    mockGenerateText.mockResolvedValue({ text: "Label: Test\nSummary: A test.", model: "gemini-2.5-flash" });
  });

  it("embedTickets: masks PII in ticket text before calling embed()", async () => {
    mockGetTicketsNeedingEmbedding.mockResolvedValue([
      {
        id: 1,
        zendesk_ticket_id: "100",
        subject: "Account issue",
        description: "Please contact me at jane.doe@example.com to resolve this.",
        embedding: null,
      },
    ]);

    await embedTickets(1, 5);

    const embedCallArg = mockEmbed.mock.calls[0][0];
    expect(embedCallArg.text).not.toContain("jane.doe@example.com");
    expect(embedCallArg.text).toContain("[REDACTED]");
  });

  it("generateClusterLabel: masks PII in representative tickets before calling generateText()", async () => {
    await generateClusterLabel([
      {
        subject: "Billing question",
        description: "My phone number is 555-123-4567, please call me back.",
      },
    ]);

    const generateCallArg = mockGenerateText.mock.calls[0][0];
    expect(generateCallArg.prompt).not.toContain("555-123-4567");
    expect(generateCallArg.prompt).toContain("[REDACTED]");
  });
});