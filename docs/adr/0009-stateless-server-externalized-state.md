# ADR-0009: Stateless server, externalized state (multi-instance readiness)

- Status: Accepted
- Date: 2026-11-02
- Jira: HCIQ-21

## Context

A Marketplace app with many installs runs behind more than one server
instance. Any correctness-critical state kept in a single process's memory
breaks or leaks the moment a second instance exists (requests may land on a
different instance than the one holding the state).

A tree audit (HCIQ-21) found the module-level mutable state below.

## Decision

Server instances are **stateless for correctness**. State that must survive
across requests is externalized (DB) or made safely per-instance (bounded,
re-derivable). Specifically:

- **OAuth CSRF state** — a signed, self-contained JWT (any instance verifies
  it with the shared `ZAF_SESSION_SECRET`), and one-time use is enforced in a
  shared DB table (`oauth_state_used`), with a 10-minute TTL via the JWT's
  expiry. No per-instance memory is involved, so start and callback can be
  served by different instances (see HCIQ-25, PR #23). Covered by
  `oauthStateCrossInstance.test.ts`.
- **Ticket-field id cache** (`ticketFieldsLookup.ts`) — kept per-instance in
  memory but **bounded**: 10-minute TTL and a 500-entry cap with oldest-first
  eviction, keyed per subdomain. Field ids are account-stable, so each
  instance re-derives independently — safe and cheap. Covered by
  `ticketFieldsCache.test.ts`.

## Audited module-level state and disposition

- `zendesk/ticketFieldsLookup.ts` → bounded cache (above). ✅
- `ai/withRetry.ts` (`lastCallStartedAt`, `throttleQueue`) → a **best-effort
  per-instance** AI throttle. Not correctness-critical; each instance paces its
  own calls. Global, fair, per-tenant rate limiting is owned by **HCIQ-22**,
  not this story.
- `jobs/analysisRunWorker.ts` (`workerRunning`) → lives in the analysis
  **worker Cloud Run Job**, which runs as a single execution (`runWorkerOnce`)
  and exits. It is not shared server state and does not affect multi-instance
  web serving.

## Consequences

- New request-serving code must not rely on module-level mutable state for
  correctness across requests. Anything that must persist goes to the DB;
  anything cached in memory must be bounded and safely re-derivable.
- `recoverInterruptedRuns()` re-queues all `running` runs on worker startup —
  valid only for the single-execution worker job; a future multi-worker setup
  (out of scope here) would need per-worker ownership/leasing.