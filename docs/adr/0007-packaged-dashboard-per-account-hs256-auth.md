# ADR-0007: Packaged dashboard with per-account HS256 bearer auth

- Status: Accepted
- Date: 2026-11-02
- Jira: HCIQ-25 (tenant isolation: HCIQ-20)

## Context

ADR-0001 established the server-side ZAF architecture (thin iframe shell +
our own backend) and referred to "JWT verification of the initial iframe
request" — an RS256 signed-URL style flow, with the dashboard implied to be
served by the backend.

During HCIQ-25 two things changed in practice:

1. The dashboard is **packaged into the ZAF app** (built into
   `zendesk-app/assets/`) and uploaded with ZCLI, rather than served as a
   page by the backend. The backend exposes JSON APIs only.
2. The app→backend authentication is a **ZAF-signed HS256 JWT** sent as a
   Bearer token, and — critically — the signing secret is **per Zendesk
   account**, not a single shared secret.

A single shared `jwt_secret` across all installs is a tenant-isolation
hole (HCIQ-20): any installer who knows it can mint a token claiming any
subdomain and read another customer's data.

## Decision

- **Dashboard delivery:** Vite builds the dashboard into
  `zendesk-app/assets/dashboard/`; the ZAF package is uploaded via ZCLI.
  The backend never serves HTML — it is an API only.
- **Auth:** every request from the packaged app carries a ZAF-signed HS256
  JWT (`Authorization: Bearer`). The signing secret is **per-account**:
  generated during the Zendesk OAuth install, stored encrypted
  (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) in `zendesk_accounts`, and written
  into that account's `jwt_secret` app setting via the Zendesk Apps API
  (`PUT /api/v2/apps/installations/{id}`). The backend verifies each token
  against the claimed account's own secret, so a token from account A
  claiming account B is rejected.
- **Manifest:** no OAuth block in the manifest; Zendesk OAuth is handled
  server-side by the global OAuth client (ADR-0004). The `jwt_secret`
  setting is `secure: true` and populated automatically after OAuth.

## Alternatives considered

**Backend-served dashboard HTML (ADR-0001's implied approach).** Rejected —
packaging the UI into the ZAF app is the Marketplace-standard delivery and
keeps the backend API-only (clear separation, no HTML/CSP concerns server-side).

**Single shared HS256 secret for all installs.** Rejected — it allows
cross-tenant spoofing (HCIQ-20). A per-account secret closes it and is
verified by `server/test/integration/tenantIsolation.test.ts`.

**RS256 signed URLs (ADR-0001's original mechanism).** Replaced — heavier
key management for no added benefit here; the ZAF `secure` setting plus a
per-account HS256 JWT is simpler and tenant-isolated.

## Consequences

- Shipping a UI change now requires repackaging and re-uploading the ZAF
  app (a pure backend change still deploys on its own) — the trade-off
  ADR-0001 already noted for iframe-shell changes.
- The OAuth install flow gains a step: generate/store the per-account
  secret and set it via the Apps API.
- ZAF caches secure settings, so the app must be reloaded once after OAuth
  for the new `jwt_secret` to take effect; the OAuth success page tells the
  user to reload.
- This supersedes the **auth mechanism and dashboard-delivery** details of
  ADR-0001. The core server-side architecture decision in ADR-0001 stands.