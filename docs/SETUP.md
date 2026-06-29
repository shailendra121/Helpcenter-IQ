# Local setup

## Prerequisites

- Node.js 20+
- Docker (for local Postgres+pgvector)
- A Zendesk trial account (`d3v-` subdomain) — see ADR-0005

## 1. Database

```bash
cd infra/docker
docker compose up -d
```

## 2. Backend

```bash
cd server
cp .env.example .env   # fill in values — see ADR-0003, ADR-0004
npm install
npm run migrate:up
npm run dev
```

## 3. Dashboard

```bash
cd dashboard
npm install
npm run dev
```

## 4. Zendesk app (ZAF)

```bash
npm install -g zcli
cd zendesk-app
zcli apps:validate
zcli apps:server   # serves the package locally for testing in a trial account
```

Install the locally-served app into your `d3v-` trial subdomain per
Zendesk's "Build your first Support app" tutorial flow. Once you're ready
to test the real OAuth flow, convert the trial to a sponsored account
first (ADR-0005) — sponsored accounts don't expire after 14 days.

## Multi-tenant note

Every table in `server/src/db/migrations/` keys off `zendesk_account_id`.
When writing queries or new endpoints, never omit that filter — see
ADR-0002.
