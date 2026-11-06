import { getValidAccessToken } from "./getValidAccessToken.js";

interface ZendeskTicketField {
  id: number;
  type: string;
  title: string;
}

// Per-subdomain cache of Intelligent Triage field ids. In-memory and
// per-instance by design (HCIQ-21): ids are account-stable, so each instance
// re-derives independently — safe and cheap. Bounded with a TTL + max size so
// it can't grow unbounded with tenant count.
interface FieldCacheEntry {
  value: Map<string, number>;
  expiresAt: number;
}

const FIELD_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FIELD_CACHE_MAX_ENTRIES = 500;

const fieldIdCache = new Map<string, FieldCacheEntry>();

function getCachedFields(subdomain: string): Map<string, number> | null {
  const entry = fieldIdCache.get(subdomain);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    fieldIdCache.delete(subdomain);
    return null;
  }
  return entry.value;
}

function setCachedFields(subdomain: string, value: Map<string, number>): void {
  // Evict the oldest entry when at capacity (Map preserves insertion order).
  if (fieldIdCache.size >= FIELD_CACHE_MAX_ENTRIES) {
    const oldest = fieldIdCache.keys().next().value;
    if (oldest !== undefined) fieldIdCache.delete(oldest);
  }
  fieldIdCache.set(subdomain, {
    value,
    expiresAt: Date.now() + FIELD_CACHE_TTL_MS,
  });
}

/**
 * Looks up the field IDs Zendesk assigned this account for its
 * Intelligent Triage system fields (Category/Intent/Sentiment). IDs are
 * account-specific, so we resolve them by field title rather than hard-coding.
 */
export async function getCopilotFieldIds(
  subdomain: string,
): Promise<Map<string, number>> {
  const cached = getCachedFields(subdomain);
  if (cached) return cached;

  const accessToken = await getValidAccessToken(subdomain);
  const response = await fetch(
    `https://${subdomain}.zendesk.com/api/v2/ticket_fields`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ticket_fields: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    ticket_fields: ZendeskTicketField[];
  };

  const idsByTitle = new Map<string, number>();
  for (const field of data.ticket_fields) {
    const normalizedTitle = field.title.trim().toLowerCase();
    if (["category", "intent", "sentiment"].includes(normalizedTitle)) {
      idsByTitle.set(normalizedTitle, field.id);
    }
  }

  setCachedFields(subdomain, idsByTitle);
  return idsByTitle;
}

export function extractCopilotValue(
  customFields: Array<{ id: number; value: unknown }> | undefined,
  fieldId: number | undefined,
): string | null {
  if (!customFields || fieldId === undefined) return null;
  const field = customFields.find((f) => f.id === fieldId);
  return typeof field?.value === "string" ? field.value : null;
}