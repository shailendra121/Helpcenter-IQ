# ADR-0004: Zendesk authentication via global OAuth

- Status: Accepted
- Date: 2026-06-29
- Jira: HCIQ-4

## Context

The backend needs to make Zendesk REST API calls on behalf of installed
customer accounts (fetch tickets, fetch Guide articles, eventually create
draft content for review).

Zendesk's Marketplace requirements state that a public or integration app
making server-side requests to Zendesk APIs may not use API tokens or
regular OAuth tokens, because Zendesk's Developer Terms prohibit customers
from sharing their API credentials with a third party. Global OAuth access
tokens must be used instead.

## Decision

Implement Zendesk authentication using **global OAuth**
(`server/src/auth/`, `server/src/zendesk/client/`). The OAuth flow runs at
install time; resulting tokens are stored encrypted, scoped per customer
account, and never logged in plaintext.

## Alternatives considered

**API tokens / regular OAuth tokens supplied by the customer.** Rejected —
explicitly disallowed by Zendesk's Marketplace requirements for public/
integration apps making server-side API requests.

## Consequences

- We must register the app's OAuth client in the Marketplace developer
  portal before any real integration testing against a non-trial account.
- Token refresh, revocation (on uninstall), and encrypted-at-rest storage
  are required from day one, not deferred.
- This requirement also reinforces ADR-0001/0002: a server-side OAuth
  token store is itself something that has to live in our own database,
  not inside Zendesk.
