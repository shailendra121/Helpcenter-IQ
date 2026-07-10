# Jira ↔ Git conventions

Project key: **HCIQ**

## Branch naming

```
<type>/HCIQ-<issue>-<short-slug>
```

Examples:
```
feat/HCIQ-23-ticket-clustering-pipeline
fix/HCIQ-41-oauth-token-refresh
chore/HCIQ-12-pgvector-migration
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `spike`.

## Commit messages

Conventional Commits, with the Jira key as a footer so Jira's GitHub/GitLab
smart-commit integration links the commit to the issue automatically:

```
feat(ai): add provider-agnostic embedding interface

Adds AIProvider interface and the Gemini implementation behind it,
per ADR-0003. OpenAI implementation follows in a separate ticket.

Refs: HCIQ-23
```

Use `Refs:` for "relates to," `Closes:` / `Fixes:` only when the commit
truly completes the issue — Jira's smart commits will transition the issue
status automatically on `Closes`/`Fixes` if smart commits are enabled for
the project.

## PR titles

Mirror the primary commit's conventional-commit header, prefixed with the
Jira key for quick scanning in the PR list:

```
HCIQ-23: feat(ai): add provider-agnostic embedding interface
```

## ADR ↔ Jira linkage

Every ADR in `docs/adr/` includes a `Jira:` field. When an ADR changes a
prior decision, the new ADR's Jira ticket should reference the old ADR's
ticket as "relates to," so the Jira issue graph mirrors the ADR supersede
chain.

## Release tagging

Git tags follow `vMAJOR.MINOR.PATCH` and the tag message lists the Jira
epic(s)/issues closed in that release, generated via
`scripts/changelog-from-jira.sh` (stub — fill in once Jira project is live).
