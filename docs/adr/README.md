# Architecture Decision Records

This folder holds ADRs (Architecture Decision Records) for HelpCenterIQ.
Each significant, hard-to-reverse technical decision gets one file, numbered
sequentially, never renumbered or deleted — superseded decisions are marked
`Superseded by ADR-00XX`, not removed, so the history stays intact.

## Format

Each ADR follows:

```
# ADR-XXXX: <Title>

- Status: Proposed | Accepted | Superseded by ADR-YYYY | Deprecated
- Date: YYYY-MM-DD
- Jira: HCIQ-XXX (if applicable)

## Context
What problem/question prompted this decision.

## Decision
What we decided.

## Alternatives considered
What else we looked at, and why we didn't pick it.

## Consequences
What this makes easier, harder, or constrains going forward.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-server-side-zaf-architecture.md) | Server-side ZAF architecture (not pure client-side, not native-only) | Accepted |
| [0002](./0002-database-postgres-pgvector.md) | Single Postgres + pgvector store (not Zendesk Custom Objects, not separate vector DB) | Accepted |
| [0003](./0003-ai-provider-abstraction-and-pii-masking.md) | AI provider abstraction, zero-data-retention, PII masking | Accepted |
| [0004](./0004-zendesk-auth-global-oauth.md) | Zendesk authentication via global OAuth | Accepted |
| [0005](./0005-account-tiers-trial-sponsored-marketplace.md) | Zendesk account strategy: trial → sponsored → Marketplace registration | Accepted |
