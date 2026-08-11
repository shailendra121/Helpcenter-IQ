import { createAIProvider } from "../ai/providers/index.js";
import { maskPII } from "../pii/maskPII.js";
import { withRetry } from "../ai/withRetry.js";

export interface TicketExcerpt {
  subject: string | null;
  description: string | null;
}

export interface ClusterLabelResult {
  label: string;
  summary: string;
}

/**
 * Generates a short, human-readable topic label + one-line summary for
 * a cluster, using representative ticket excerpts as context. Per
 * ADR-0003 (non-negotiable): excerpts are masked before ever reaching
 * the AI provider — same rule as embed().
 */
export async function generateClusterLabel(
  representativeTickets: TicketExcerpt[]
): Promise<ClusterLabelResult> {
  const provider = createAIProvider();

  const rawExcerpts = representativeTickets
    .map((t, i) => `Ticket ${i + 1}:\nSubject: ${t.subject ?? "(none)"}\nDescription: ${t.description ?? "(none)"}`)
    .join("\n\n");

  const { maskedText } = maskPII(rawExcerpts);

  const prompt = `You are analyzing a cluster of customer support tickets that share a common theme.
Here are representative examples from the cluster:

${maskedText}

Respond with EXACTLY two lines, no extra text:
Label: <a short 2-5 word topic name>
Summary: <one sentence describing what this cluster of tickets is about>`;

const { text } = await withRetry(() => provider.generateText({ prompt }));

  const labelMatch = text.match(/Label:\s*(.+)/i);
  const summaryMatch = text.match(/Summary:\s*(.+)/i);

  return {
    label: labelMatch?.[1]?.trim() ?? "Unlabeled topic",
    summary: summaryMatch?.[1]?.trim() ?? "",
  };
}