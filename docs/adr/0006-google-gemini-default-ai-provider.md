# ADR-0006: Google Gemini as the default AI provider

- Status: Accepted
- Date: 2026-07-10
- Jira: HCIQ-6
- Amends: [ADR-0003](./0003-ai-provider-abstraction-and-pii-masking.md)

## Context

ADR-0003 established the provider-agnostic `AIProvider` abstraction, the
zero-data-retention (ZDR) requirement, and mandatory PII masking — but the
scaffold's concrete default implementation was Anthropic
(`AnthropicProvider`, `AI_PROVIDER=anthropic`), and Sprint 1 stories
(HCIQ-1, HCIQ-5) assumed an Anthropic API key.

During MVP development we have no revenue and want to minimize burn. Google
Gemini offers a free API tier suitable for development and evaluation,
whereas Anthropic and OpenAI require paid API usage from the first call.

## Decision

1. **Google Gemini becomes the default AI provider.** `GeminiProvider`
   implements the existing `AIProvider` interface
   (`server/src/ai/providers/`); the factory default becomes
   `AI_PROVIDER=gemini` with `GEMINI_API_KEY` in env. The abstraction from
   ADR-0003 is unchanged — this ADR swaps the default implementation, not
   the architecture.
2. **Free tier is for development and testing only, with synthetic or
   masked sample data.** Google's free-tier terms permit use of submitted
   content to improve their products, which does **not** satisfy ADR-0003's
   ZDR requirement.
3. **Production (real customer ticket data) requires the paid Gemini API
   tier**, under terms where prompts/responses are not used for training.
   Confirming the then-current data-use terms in writing is a launch
   blocker, tracked on the go-live checklist.
4. Model selection (embedding model, generation model) lives in env config,
   not code, so model upgrades don't require releases.
5. `AnthropicProvider` is removed from the default path but the pattern
   remains: reinstating Anthropic (or adding OpenAI) means implementing the
   interface, per ADR-0003.

## Alternatives considered

**Stay on Anthropic.** Rejected for MVP economics — no free tier; every
development iteration costs money before we have a single customer. The
abstraction makes returning to Anthropic cheap if Gemini disappoints on
quality or terms.

**OpenAI.** Same cost profile as Anthropic (no meaningful free API tier);
no differentiating advantage for our workload.

**Use free tier in production too.** Rejected outright — sending customer
ticket text (even masked) through an API tier whose terms allow training
use contradicts ADR-0003 and our enterprise-readiness positioning.

## Consequences

- `server/src/ai/providers/AnthropicProvider.ts` is replaced by
  `GeminiProvider.ts`; factory, `.env.example`, `docs/SETUP.md`, and
  `docs/ENGINEERING_ONBOARDING.md` updated accordingly (Jira: HCIQ-6).
- PII masking (ADR-0003) becomes even more critical: on the free tier,
  masking is the only line of defense, which is why free tier is restricted
  to non-customer data.
- ADR-0003's decision #2 (ZDR-only providers) is amended to: "ZDR-grade
  terms required for any environment processing customer data; free-tier
  usage permitted for development with synthetic/masked data only."
- We take on tier-management complexity: dev and prod use different billing
  tiers and possibly different rate limits/models — config, not code, per
  decision 4.
- Embedding vector dimensions may differ from earlier Anthropic/OpenAI
  assumptions — the pgvector column dimension (ADR-0002 schema) must match
  the chosen Gemini embedding model before any real embeddings are stored.
