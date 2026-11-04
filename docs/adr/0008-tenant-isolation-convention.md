# ADR-0008: Tenant isolation is a model-layer convention

- Status: Accepted
- Date: 2026-11-02
- Jira: HCIQ-20

## Context

Every tenant-scoped table carries `zendesk_account_id`. HCIQ-25 made the
request layer derive the tenant only from the verified ZAF JWT session, but
some `db/models` queries still looked up or mutated rows by `id` alone
(e.g. `analysis_runs`), so a row id from another account could in principle
be read or changed below the API layer.

## Decision

Tenant isolation is enforced as a **model-layer convention**:

- Every query in `server/src/db/models/**` that reads or mutates a
  tenant-scoped row MUST include `zendesk_account_id` in its `WHERE`
  (and in `ON CONFLICT` targets where relevant) — never `WHERE id = $1`
  alone. Callers pass the account id, which comes from the verified ZAF
  session (API) or from the claimed run row (worker).
- The request layer takes the tenant only from the verified ZAF JWT —
  never from a query param or request body (see ADR-0007).
- A two-account integration test
  (`server/test/integration/tenantDataIsolation.test.ts`) proves zero
  cross-account visibility and runs as a CI merge gate.

## Alternatives considered

**Row-level security (RLS) in Postgres.** Stronger, but adds per-request
session-variable plumbing and complicates the shared connection pool. The
model-layer convention plus the isolation test is sufficient for the MVP;
RLS can be revisited before scale.

## Consequences

- Model functions for tenant-scoped tables take a `zendeskAccountId`
  parameter; cross-account reads return nothing and cross-account mutations
  are no-ops.
- New model queries must follow the convention; the two-account test is the
  guardrail that catches violations.

## Enforcement

The two-account isolation tests are the guardrail:

- `tenantDataIsolation.test.ts` — model-level (`analysis_runs`): a run id from
  another account returns nothing on read and is a no-op on mutation.
- `apiTenantIsolation.test.ts` — API-level: account A's token against account
  B's ids (session, gaps, gap detail, drafts, draft edit/status/regenerate,
  create-draft-from-gap, `analysis-runs/:id`) returns 404 / nothing and changes
  nothing of B's.

Any new tenant-scoped query that omits `zendesk_account_id` will surface as a
cross-account leak in these tests when its endpoint is exercised. New
data-serving endpoints MUST be added to `apiTenantIsolation.test.ts` as part of
the change, so the guardrail keeps pace. A lightweight static check (grep
`db/models` for a tenant-table query without `zendesk_account_id`) is a
tracked follow-up.