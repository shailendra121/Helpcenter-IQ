# ADR-0003: AI provider abstraction, zero-data-retention, PII masking

- Status: Accepted
- Date: 2026-06-29
- Jira: HCIQ-3

## Context

Clustering, gap detection, and draft article generation require calling a
generative AI model. We considered using Zendesk's own AI capabilities to
avoid sending customer data to a separate AI vendor.

We also have a stated product goal (see `PROJECT_SCOPE.md`, "Enterprise
readiness") of PII masking, audit logs, and configurable AI model usage.

## Decision

1. Bring our own AI provider, accessed through an internal abstraction
   (`server/src/ai/providers/`) so the underlying vendor (Anthropic,
   OpenAI, etc.) is swappable per the scope doc's "configurable AI model
   usage" requirement, and so we are not locked to one vendor's pricing or
   roadmap.
2. Use only providers offering a **zero-data-retention** API agreement —
   data is used for inference only, never retained or used for training.
3. Run all outbound ticket text through a **PII masking step**
   (`server/src/pii/`) before it reaches any AI provider call.
4. Log AI provider calls (without raw PII) for audit purposes.

## Alternatives considered

**Using Zendesk's native AI (Intelligent Triage, Copilot, Content Cues)
for clustering/drafting.** Rejected — these are Zendesk-operated features
over Zendesk's own infrastructure, with no public API for a third-party
Marketplace app to invoke as part of a custom pipeline. Zendesk's Content
Cues feature is the closest conceptual match to our gap-detection feature,
but is an Admin Center feature, not an API we can call, and is gated to
Suite Enterprise. We will still read Topic/Sentiment/Intent ticket fields
when present (set by Zendesk Copilot) as a free input signal to our own
clustering — this is additive, not a replacement.

**Single hard-coded AI vendor with no abstraction.** Rejected — conflicts
with the scope doc's stated enterprise requirement for "configurable AI
model usage," and creates vendor lock-in risk for pricing/availability.

## Consequences

- Every AI call in the codebase goes through one interface; adding or
  swapping a provider means implementing that interface, not touching
  calling code.
- PII masking is a mandatory pipeline stage, not optional middleware — no
  code path should be able to call an AI provider with unmasked ticket
  text.
- We must contractually confirm zero-data-retention terms with whichever
  provider(s) we integrate, and revisit this ADR if that status changes.
- This does not achieve "no data leaves Zendesk" in an architectural
  sense — see ADR-0001 — it achieves a defensible, disclosed, contractually
  bounded data-handling posture instead.
