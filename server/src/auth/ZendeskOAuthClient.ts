/**
 * Global OAuth client for Zendesk API access. See ADR-0004 — customer
 * API tokens / regular OAuth tokens must never be requested or stored;
 * this is the only sanctioned path for obtaining Zendesk API credentials.
 */

export interface ZendeskOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  scope: string;
  expiresAt: Date;
}

export class ZendeskOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  buildAuthorizeUrl(subdomain: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: "read write",
      state,
    });
    return `https://${subdomain}.zendesk.com/oauth/authorizations/new?${params.toString()}`;
  }

  async exchangeCodeForToken(
    _subdomain: string,
    _code: string,
    _redirectUri: string,
  ): Promise<ZendeskOAuthTokens> {
    // TODO(HCIQ-XX): POST to /oauth/tokens, persist encrypted via
    // server/src/db/models, per ADR-0004.
    throw new Error("Not implemented");
  }
}
