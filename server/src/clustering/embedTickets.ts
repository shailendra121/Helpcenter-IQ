import { createAIProvider } from "../ai/providers/index.js";
import { maskPII } from "../pii/maskPII.js";
import {
  getTicketsNeedingEmbedding,
  updateTicketEmbedding,
} from "../db/models/tickets.js";
import { withRetry } from "../ai/withRetry.js";

/**
 * Generates and stores embeddings for all tickets in an analysis run
 * that don't have one yet. Per ADR-0003 (non-negotiable): ticket text
 * is masked before ever reaching embed() — this is the only line of
 * defense on the Gemini free tier per ADR-0006.
 */
export async function embedTickets(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<{ embedded: number; skipped: number }> {
  const provider = createAIProvider();
  const tickets = await getTicketsNeedingEmbedding(zendeskAccountId, analysisRunId);

  let embedded = 0;
  let skipped = 0;

  for (const ticket of tickets) {
    const rawText = [ticket.subject, ticket.description].filter(Boolean).join("\n\n");

    if (!rawText.trim()) {
      skipped++;
      continue;
    }

    const { maskedText } = maskPII(rawText);
    const { vector } = await withRetry(() => provider.embed({ text: maskedText }));
    await updateTicketEmbedding(ticket.id, vector);
    embedded++;
  }

  return { embedded, skipped };
}