# Contributing

## Before you start

1. Find or create the Jira issue (project key `HCIQ`) for the work.
2. If the change is architectural (new dependency category, new data flow,
   new external system, anything that would be painful to reverse), write
   an ADR first — see `docs/adr/README.md` — and get it accepted before
   implementation.

## Workflow

1. Branch: `<type>/HCIQ-<issue>-<slug>` — see `docs/JIRA.md`.
2. Commit using the repo's commit template:
   ```
   git config commit.template .gitmessage
   ```
3. Open a PR using the provided template; link the Jira issue and any
   relevant ADRs.
4. CI (`.github/workflows/ci.yml`) must pass: lint, typecheck, tests, ZAF
   package validation.
5. At least one CODEOWNERS-matched reviewer approves before merge.

## Code locations — quick map

| Change you're making | Where it lives |
|---|---|
| Zendesk iframe shell / manifest | `zendesk-app/` |
| API routes / controllers | `server/src/api/` |
| Zendesk OAuth / API client | `server/src/zendesk/` |
| AI provider calls | `server/src/ai/providers/` (never call a provider SDK directly elsewhere) |
| PII masking logic | `server/src/pii/` |
| Background/scheduled jobs (ticket analysis runs) | `server/src/jobs/` |
| DB schema changes | `server/src/db/migrations/` (new migration file, never edit an applied one) |
| Dashboard UI | `dashboard/src/` |
| Infra/deploy config | `infra/` |

## Data-handling rules (non-negotiable, see ADR-0003)

- No raw ticket text reaches an AI provider call without passing through
  `server/src/pii/` first.
- No AI provider call happens outside `server/src/ai/providers/`.
- No Zendesk customer API token is ever requested, stored, or logged — see
  ADR-0004. Only global OAuth tokens, issued through our own OAuth client.
