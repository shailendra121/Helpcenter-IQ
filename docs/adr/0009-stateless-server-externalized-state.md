# ADR-0009: Stateless server, externalized state (multi-instance readiness)

- Status: Accepted
- Date: 2026-11-05
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

- `zendesk/ticketFieldsLookup.ts` → bounded cache (above). 
- `ai/withRetry.ts` (`lastCallStartedAt`, `throttleQueue`) → a **best-effort
  per-instance** AI throttle. Not correctness-critical; each instance paces its
  own calls. Global, fair, per-tenant rate limiting is owned by **HCIQ-22**,
  not this story.
- The old in-process worker loop (`startAnalysisRunWorker` / `workerRunning`)
  has been removed; the worker now runs as a single-shot Cloud Run Job
  (`runWorkerOnce`) with stale-run recovery, so no long-lived worker state remains.

## Consequences

- New request-serving code must not rely on module-level mutable state for
  correctness across requests. Anything that must persist goes to the DB;
  anything cached in memory must be bounded and safely re-derivable.
- The worker runs as a single-shot Cloud Run Job, and executions can overlap
  (Cloud Scheduler every 10 min, plus an API-triggered run when one is queued).
  On startup each execution calls `recoverStaleRuns()`, which re-queues only
  runs whose last claim (`claimed_at`) is older than the job timeout. A run
  another execution is actively processing keeps a fresh `claimed_at`, so it is
  never re-queued and cannot run twice. Proven by `recoverStaleRuns.test.ts`.