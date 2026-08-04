import { getValidAccessToken } from "./getValidAccessToken.js";

interface ZendeskTicketField {
  id: number;
  type: string;
  title: string;
}

// Cache per subdomain so we don't re-fetch field metadata on every ticket.
const fieldIdCache = new Map<string, Map<string, number>>();

/**
 * Looks up the field IDs Zendesk assigned this account for its
 * Intelligent Triage system fields (Category/Intent/Sentiment). These
 * are custom_fields entries, not top-level ticket properties — see
 * Zendesk's "Can I use the API to access intent, sentiment, and
 * language from tickets?" article. IDs are account-specific, so we
 * resolve them by field title rather than hard-coding IDs.
 */
export async function getCopilotFieldIds(subdomain: string): Promise<Map<string, number>> {
  const cached = fieldIdCache.get(subdomain);
  if (cached) return cached;

  const accessToken = await getValidAccessToken(subdomain);
  const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/ticket_fields`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ticket_fields: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { ticket_fields: ZendeskTicketField[] };

  const idsByTitle = new Map<string, number>();
  for (const field of data.ticket_fields) {
    const normalizedTitle = field.title.trim().toLowerCase();
    if (["category", "intent", "sentiment"].includes(normalizedTitle)) {
      idsByTitle.set(normalizedTitle, field.id);
    }
  }

  fieldIdCache.set(subdomain, idsByTitle);
  return idsByTitle;
}

export function extractCopilotValue(
  customFields: Array<{ id: number; value: unknown }> | undefined,
  fieldId: number | undefined
): string | null {
  if (!customFields || fieldId === undefined) return null;
  const field = customFields.find((f) => f.id === fieldId);
  return typeof field?.value === "string" ? field.value : null;
}