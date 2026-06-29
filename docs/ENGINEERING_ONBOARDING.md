# HelpCenterIQ — Engineering Onboarding & Technical Overview

> Audience: any developer joining the project. Read this end to end before
> your first PR. It links out to `PROJECT_SCOPE.md` and `docs/adr/` rather
> than repeating them — those stay the source of truth; this doc is the
> map that ties them together.

---

## 1. What we're building, in one paragraph

HelpCenterIQ is a Zendesk Marketplace app. It reads a customer's Zendesk
support tickets, clusters repeated customer questions into "knowledge
topics" using AI, checks whether each topic is already covered by an
existing Zendesk Guide (help center) article, classifies the gap
(**missing / weak / outdated / good coverage**), and — for real gaps —
generates a **draft** article a human reviews and publishes. A dashboard
surfaces the highest-impact gaps by estimated ticket volume so a knowledge
manager knows what to write next.

It does **not** auto-publish anything, and it does not try to resolve
tickets in real time. It's a knowledge-base health tool, not a chatbot.

**Read next:** `PROJECT_SCOPE.md` — full product scope, MVP boundaries,
target customers, pricing model, success metrics. Everything in this
onboarding doc assumes you've read that first.

## 2. Why this is harder than it sounds (read this before touching code)

A few things surprise people coming in:

- **There is no "Zendesk database" we can write into.** Zendesk doesn't
  expose a general-purpose data layer to third-party apps the way
  Salesforce does to native Apex apps. We bring our own Postgres. See
  `docs/adr/0002-database-postgres-pgvector.md` if you're tempted to reach
  for Zendesk Custom Objects for anything beyond a trivial lookup — don't.
- **We can't use Zendesk's own AI (Copilot/Intelligent Triage/Content
  Cues) to do our clustering or drafting.** Those are Zendesk-operated
  features with no public API for third-party apps to invoke as part of a
  custom pipeline. We bring our own AI provider call. See
  `docs/adr/0003-ai-provider-abstraction-and-pii-masking.md`. (We *do*
  read Topic/Sentiment fields Zendesk Copilot sets on tickets, when
  present, as a free input signal — that's additive, not a replacement.)
- **We cannot use customer API tokens or regular OAuth tokens.** Zendesk's
  Marketplace terms prohibit it for a public/integration app making
  server-side requests. Every Zendesk API call from our backend goes
  through global OAuth, issued through our own registered OAuth client.
  See `docs/adr/0004-zendesk-auth-global-oauth.md`.
- **Every database row belongs to exactly one customer.** This is a
  multi-tenant system. Every table carries `zendesk_account_id`. There is
  no query anywhere in this codebase that should omit that filter. Get
  this wrong and one customer can see another customer's tickets.
- **No raw ticket text reaches an AI provider unmasked.** Ticket bodies
  contain customer PII (emails, phone numbers, sometimes payment info).
  Masking happens in exactly one place (`server/src/pii/`) and every AI
  call goes through exactly one interface (`server/src/ai/providers/`).
  If you find yourself calling an AI SDK directly from anywhere else,
  stop — that's the wrong pattern, not a shortcut.

If you only remember five things from this document, those are the five.

## 3. System architecture

### 3.1 The shape of the system

```
                         Zendesk (customer's account)
                         ────────────────────────────
                         Tickets API · Guide API
                         OAuth authorization server
                                    │
                                    │ (global OAuth, HTTPS)
                                    ▼
        ┌──────────────────────────────────────────────────────┐
        │                    Our backend (server/)              │
        │                                                        │
        │  api/         REST endpoints the dashboard calls       │
        │  zendesk/     OAuth client, ticket/article fetchers,   │
        │               JWT verification for ZAF requests        │
        │  jobs/        scheduled/background analysis runs       │
        │  pii/         mandatory masking before any AI call     │
        │  ai/          provider-agnostic interface + impls      │
        │               (Anthropic, swappable)                   │
        │  db/          Postgres + pgvector — accounts, runs,     │
        │               knowledge_gaps, draft_articles, audit_logs│
        └──────────────────────────┬───────────────────────────┘
                                    │ serves HTML/JS for the iframe
                                    ▼
        ┌──────────────────────────────────────────────────────┐
        │              dashboard/ (React, served by backend)    │
        │   Knowledge Gap Dashboard, draft review UI             │
        └──────────────────────────┬───────────────────────────┘
                                    │ rendered inside
                                    ▼
        ┌──────────────────────────────────────────────────────┐
        │     zendesk-app/ — thin ZAF iframe shell + manifest    │
        │     (this is the only piece submitted to the           │
        │      Zendesk Marketplace as the "app")                 │
        └──────────────────────────────────────────────────────┘
                                    ▲
                                    │ loaded inside
                         Zendesk Agent Workspace (nav_bar)
```

This is a **server-side Zendesk app**: the thing installed from the
Marketplace is a thin shell (`zendesk-app/`). All real logic, state, and
the AI pipeline live in infrastructure we operate (`server/`, `dashboard/`).
Full reasoning: `docs/adr/0001-server-side-zaf-architecture.md`.

### 3.2 Data flow for one analysis run

1. Admin triggers (or a schedule triggers) an analysis run for window
   `30/60/90` days.
2. `server/src/zendesk/` fetches tickets via the Zendesk Tickets API
   (incremental export, side-loaded where useful) and existing Guide
   articles via the Guide API, using the account's stored global OAuth
   token.
3. Raw ticket text → `server/src/pii/maskPII.ts` → masked text only from
   here onward.
4. Masked text → `server/src/ai/providers/` → embeddings for clustering +
   semantic comparison against Guide article embeddings (stored in
   `knowledge_gaps.topic_embedding`, a `pgvector` column).
5. Each cluster gets classified (`missing`/`weak`/`outdated`/
   `good_coverage`) and written to `knowledge_gaps`.
6. For real gaps, a draft is generated (also via the AI provider
   interface, also on masked input) and written to `draft_articles` with
   `review_status = pending_review`.
7. Dashboard (`dashboard/`) reads `knowledge_gaps` + `draft_articles`
   through `server/src/api/` and renders the prioritized list. A reviewer
   approves/edits/rejects — nothing reaches Zendesk Guide automatically.

### 3.3 Why these specific technology choices

| Choice | Why | ADR |
|---|---|---|
| Server-side ZAF app, not pure client-side | Need scheduled jobs, secrets, persistence — none of which a static client-side app can have | 0001 |
| Single Postgres + `pgvector`, not Sunshine Custom Objects, not a separate vector DB | Custom Objects are for small structured records tied to tickets/users, not pipeline state; legacy Custom Objects are being removed 2026-07-27 anyway; a separate vector DB is unjustified extra ops at MVP scale | 0002 |
| AI provider behind an interface, zero-data-retention vendor, mandatory PII masking | Scope doc requires "configurable AI model usage"; no Zendesk-native AI API covers our use case; PII has to be protected regardless of vendor | 0003 |
| Global OAuth only | Zendesk Marketplace terms prohibit asking customers for API tokens | 0004 |
| Free trial → sponsored dev account → Marketplace portal registration | No paid Partner tier needed to build or publish | 0005 |

## 4. Repo map

```
zendesk-app/   ZAF manifest + thin iframe shell — the Marketplace package
server/        Backend: API, Zendesk integration, AI pipeline, jobs, DB
dashboard/     React UI, served by server/, rendered inside the ZAF iframe
infra/         docker-compose (local dev) + Terraform (dev/staging/prod)
docs/          This doc, ADRs, setup guide, Jira conventions
scripts/       One-off / release scripts
.github/       CI, PR/issue templates, CODEOWNERS
```

Full per-folder breakdown of where specific kinds of changes go:
`CONTRIBUTING.md`, section "Code locations — quick map."

## 5. Getting your environment running

Full step-by-step: `docs/SETUP.md`. Short version:

```bash
cd infra/docker && docker compose up -d        # Postgres + pgvector
cd server && cp .env.example .env && npm install && npm run migrate:up && npm run dev
cd dashboard && npm install && npm run dev
```

For testing against real Zendesk: get a free trial account
(`d3v-` subdomain), then read `docs/adr/0005-account-tiers-trial-sponsored-marketplace.md`
before you go further — there's a specific account progression to follow
(trial → sponsored → Marketplace portal registration), and the sponsored
account must never be used to handle real customer support traffic.

## 6. Prerequisite skills

This isn't a beginner-friendly codebase to ramp into cold — it touches a
third-party platform's app framework, a real AI pipeline with data-
handling constraints, and a multi-tenant database. Here's what you need
walking in, split by what's load-bearing vs. nice-to-have.

### Required

- **TypeScript / modern Node.js** — the entire backend and dashboard are
  TypeScript. You should be comfortable with `async`/`await`, types,
  interfaces, and npm workspaces without needing a primer.
- **SQL and relational schema design** — you'll be writing migrations
  (`server/src/db/migrations/`) and queries against a multi-tenant schema.
  You need to understand foreign keys, indexes, and why a missing
  `WHERE zendesk_account_id = ...` clause is a data leak, not a bug.
  Familiarity with `node-pg-migrate` or a similar migration tool is a
  plus, not a blocker.
- **REST API integration experience** — comfortable reading third-party
  API docs, handling OAuth 2.0 authorization-code flows, pagination, rate
  limiting, and webhook verification (we verify a signed JWT on every ZAF
  iframe request — see `server/src/zendesk/client/verifyZafJwt.ts`).
- **Working knowledge of LLM-backed application patterns** — you don't
  need to have trained a model, but you should understand what an
  embedding is, what RAG/semantic search means at a practical level, and
  why prompt construction (`server/src/ai/prompts/`) is application code
  worth testing, not an afterthought.
- **Data privacy fundamentals** — you need to genuinely understand *why*
  PII masking happens before an AI call, not just follow the pattern by
  rote. If "why can't I just send the raw ticket text, it's faster" is
  your instinct, read `docs/adr/0003` twice before your first PR touching
  `server/src/pii/` or `server/src/ai/`.
- **Git fluency** — conventional commits, feature branches, rebase vs.
  merge, and comfort with the workflow in `CONTRIBUTING.md` and
  `docs/JIRA.md`.

### Strongly preferred

- **Prior experience with any SaaS platform's "app framework"** —
  Zendesk Apps Framework (ZAF), Salesforce Lightning, Shopify apps,
  Slack apps, or similar. The specific APIs differ but the shape of the
  problem (iframe sandboxing, OAuth installs, manifest-driven
  capabilities, marketplace review processes) transfers directly. If
  you've never worked inside someone else's platform constraints before,
  budget extra ramp time for section 3 of this doc.
- **React** — the dashboard is React; you'll be productive faster if this
  isn't your first React codebase, though it's a small surface area.
- **Background job / scheduling patterns** — analysis runs aren't
  request/response; understanding queues, retries, and idempotency will
  help once `server/src/jobs/` has real implementations.
- **Terraform** — useful for anyone touching `infra/`, not required for
  application engineers focused on `server/` or `dashboard/`.

### Not required, but read before you ship anything customer-facing

- Zendesk's own developer docs on building a server-side app and on ZAF
  JWT security — linked from `docs/adr/0001`. You don't need to have read
  these cover-to-cover before your first PR, but you do need to read them
  before you ship anything that talks to a real (non-trial) Zendesk
  account.

## 7. How work is tracked and merged

Project key: **HCIQ** in Jira. Branch names, commit message format, PR
title format, and how ADRs cross-reference Jira issues are all defined in
`docs/JIRA.md` — read it before your first branch.

Quick version: branch `feat/HCIQ-123-short-slug`, commit with a `Refs:
HCIQ-123` (or `Closes:` if it resolves the issue) footer, open a PR using
the repo's PR template (it'll ask you to confirm no raw PII reached an AI
call outside `server/src/pii/`, and whether migrations are included).
CODEOWNERS (`.github/CODEOWNERS`) routes anything touching
`server/src/ai/`, `server/src/pii/`, or `server/src/auth/` through a
security-tagged reviewer automatically — that's intentional friction, not
a mistake.

## 8. First week, concretely

A reasonable ramp path for a new engineer:

1. **Day 1:** Read `PROJECT_SCOPE.md`, this doc, and all five ADRs in
   `docs/adr/`. Get the local environment running per `docs/SETUP.md`.
2. **Day 2:** Trace one full analysis run by reading code, not just docs
   — start at `server/src/zendesk/`, follow data through `server/src/pii/`,
   into `server/src/ai/providers/`, into `server/src/db/migrations/` to
   see where it lands. Don't run anything against a real Zendesk account
   yet.
3. **Day 3:** Get a free Zendesk trial account, rename the subdomain with
   the `d3v-` prefix, and walk through `zcli apps:server` serving the ZAF
   shell locally into it, per `docs/SETUP.md` step 4.
4. **Day 4–5:** Pick up a small, well-scoped `HCIQ` ticket — ideally
   something in `server/src/api/` or `dashboard/` that doesn't touch
   `ai/`, `pii/`, or `auth/` for your very first PR, so you get the
   workflow (branch → commit → PR → CODEOWNERS review → CI) under your
   belt before taking on anything security-reviewed.

## 9. Who to ask

- Architecture / "why was it built this way" questions → check
  `docs/adr/` first; if it's not answered there, it's probably genuinely
  undecided — raise it as a new ADR candidate per `CONTRIBUTING.md`, not
  a Slack aside that gets lost.
- Zendesk platform questions (API limits, ZAF quirks, Marketplace
  submission process) → Zendesk's own developer docs are authoritative
  and change over time; don't rely on memory or old blog posts for
  anything related to current limits, pricing, or submission
  requirements.
