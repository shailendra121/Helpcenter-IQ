# ADR-0002: Single Postgres + pgvector store

- Status: Accepted
- Date: 2026-06-29
- Jira: HCIQ-2

## Context

The app needs to persist: ticket clustering output, topic/gap
classifications per analysis run, semantic embeddings for matching tickets
against Guide articles, generated draft articles with review/edit/approval
state, and audit logs.

We considered whether this data could live inside Zendesk itself (Sunshine
Custom Objects) instead of an external database we operate.

## Decision

Use a single managed **PostgreSQL** instance with the **pgvector**
extension for both relational data and vector similarity search. No
separate vector database, no Zendesk-side storage for this data.

## Alternatives considered

**Zendesk Sunshine Custom Objects.** Rejected — designed for simple
structured records related to tickets/users (e.g., shop-ID-to-manager
lookups), not for AI pipeline state, embeddings, or versioned draft
content with review workflows. Legacy custom objects are also being fully
deprecated 2026-07-27; new custom objects creation under the legacy model
was already disallowed from 2026-01-15. Not a viable long-term store
regardless of fit.

**Separate vector DB (e.g., Pinecone, Weaviate) alongside Postgres.**
Rejected for MVP — adds an extra system to operate, secure, and keep in
sync with relational state for marginal benefit at our expected data
volume. `pgvector` is sufficient for per-tenant semantic search at MVP
scale; revisit if/when corpus size or query latency demands it.

## Consequences

- One system to provision, back up, secure, and reason about for MVP.
- Multi-tenant isolation (one customer's tickets/articles must never be
  visible to another) is enforced at the schema/row level — see
  `server/src/db/models` and migration conventions in `docs/SETUP.md`.
- If vector search performance becomes a bottleneck post-MVP, the path is
  to add a dedicated vector store without changing the relational schema,
  not to redesign storage from scratch.
