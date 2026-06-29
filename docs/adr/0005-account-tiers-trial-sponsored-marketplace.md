# ADR-0005: Zendesk account strategy

- Status: Accepted
- Date: 2026-06-29
- Jira: HCIQ-5

## Context

Building and eventually publishing on the Zendesk Marketplace requires
deciding what kind of Zendesk account(s) the team develops and tests
against, and when/whether a paid "Partner Program" tier is required.

## Decision

Three-stage account progression, all free:

1. **Free 14-day trial** (`d3v-` subdomain prefix) for initial local
   development.
2. **Sponsored developer account** — convert the trial once development is
   underway. Zendesk sponsors a Suite Enterprise-equivalent instance (up to
   5 agents) for as long as needed, specifically for building/demoing/
   troubleshooting a Marketplace app. Must not be used to provide real
   customer support (Zendesk suspends accounts used that way).
3. **Marketplace developer portal registration** (apps.zendesk.com) —
   required before submitting the app for listing, public or private/
   preview. This is org registration, not a paid program.

The separate **Technology Partner Program** (with benefits like Solutions
Architect consultations) is treated as optional and deferred — it is not a
prerequisite for development or for publishing a public Marketplace app.

## Alternatives considered

**Going straight for Technology Partner Program enrollment.** Rejected
for now — adds process overhead with no capability we need at MVP stage;
revisit post-launch if we want the associated support/co-marketing
benefits.

## Consequences

- No cost to reach a publishable app.
- We must remember to convert the trial before day 14, and to re-register
  request headers (`X-Zendesk-Marketplace-App-Id`, `-Organization-Id`)
  once the app is accepted and IDs are issued — see
  `server/src/zendesk/client/` for where these headers are set.
- Production customer accounts are entirely separate from our sponsored
  dev/test account; no production customer data should ever touch the
  sponsored instance.
