import { ZendeskOAuthClient } from "./ZendeskOAuthClient.js";

/**
 * Single place that reads ZENDESK_OAUTH_CLIENT_ID/SECRET and builds a
 * ZendeskOAuthClient. Used by both the OAuth routes (initial handshake)
 * and getValidAccessToken (refresh) — extracted here so the two never
 * drift out of sync.
 */
export function getOAuthClient(): ZendeskOAuthClient {
  const clientId = process.env.ZENDESK_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ZENDESK_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ZENDESK_OAUTH_CLIENT_ID / ZENDESK_OAUTH_CLIENT_SECRET are not set");
  }
  return new ZendeskOAuthClient(clientId, clientSecret);
}