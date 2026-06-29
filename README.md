# HelpCenterIQ

AI-powered knowledge gap intelligence for Zendesk.

HelpCenterIQ analyzes Zendesk support tickets to identify missing, weak, or
outdated help center articles and recommends content improvements that
reduce repeat tickets.

> Find knowledge gaps in Zendesk tickets and turn them into better help
> center content.

## Repo layout

```
zendesk-app/   Zendesk Apps Framework (ZAF) package — manifest, thin iframe shell.
                Submitted to the Zendesk Marketplace as a server-side app.
server/        Backend — API, Zendesk integration, AI pipeline, jobs, DB.
dashboard/     Frontend served by server/, rendered inside the ZAF iframe.
infra/         Docker + Terraform for environments (dev/staging/production).
docs/          Architecture decision records, diagrams, project docs.
scripts/       One-off / dev / release scripts.
.github/       CI workflows, issue + PR templates.
```

## Architecture summary

- **Pattern:** Zendesk server-side app (thin ZAF iframe, real logic lives on
  our infrastructure). See `docs/adr/0001-server-side-zaf-architecture.md`.
- **Backend:** Node.js / TypeScript.
- **Database:** PostgreSQL + `pgvector` (relational + embeddings, one store).
- **AI:** Provider-abstracted (`server/src/ai/providers/`), zero-data-retention
  agreement, PII masked before any request leaves our backend.
- **Zendesk auth:** Global OAuth (per Zendesk Marketplace requirements — no
  customer API tokens).

See `docs/adr/` for the full reasoning behind each decision, and
`PROJECT_SCOPE.md` for the product brief this build is based on.

## Getting started

See `docs/SETUP.md`.

## Project management

Work is tracked in Jira under project key **HCIQ**. See `docs/JIRA.md` for
the workflow, ticket conventions, and how commits/PRs link back to issues.
