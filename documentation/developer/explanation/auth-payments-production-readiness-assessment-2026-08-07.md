# Authentication and Payments Production-Readiness Assessment

This historical assessment, captured on 2026-08-07, initiated the production-readiness work in
[`PLAN.md`](../../../PLAN.md). Its point-in-time code findings and static launch proof have been
superseded by packages A–D. This page preserves the decisions, not obsolete implementation claims.

## Decisions retained

- Clerk is the identity and session provider. Ask Siargao owns local profile, chat, commerce,
  closure, and retention state.
- The one-time Trip Pass uses direct Stripe Checkout. Stripe owns money facts; the local ledger owns
  access and the commercial answer meter.
- Checkout enablement is an explicit `off`/`canary`/`on` rollout decision and remains `off` in
  repository evidence.
- Signed provider webhooks, idempotent inbox application, durable workers, live reconciliation,
  Operator allowlist plus fresh MFA, minimized retention, and terminal Account Closure are required
  production boundaries.
- Engineering readiness and human launch authorization are separate conclusions.

## Current sources of truth

- [Clerk authentication and account lifecycle](../reference/clerk-auth-session-chat-history-requirements.md)
- [Trip Pass reconciliation and repair](../reference/trip-pass-reconciliation.md)
- [Environment reference](../reference/environment.md)
- [Release-candidate QA](../how-to-guides/run-release-candidate-qa.md)
- [Launch Trip Pass](../how-to-guides/launch-trip-pass.md)
- [Payment/access authority ADR](../../../docs/adr/0002-separate-payment-and-access-authority.md)
- [Direct Stripe Trip Pass ADR](../../../docs/adr/0006-launch-only-direct-stripe-trip-pass-commerce.md)

The deterministic `qa:trip-pass-launch -- --write` artifact replaces the removed dated static
proof. Protected Clerk and Stripe evidence is produced only by an eligible human after merge using
dedicated test resources; ordinary pull-request CI does not claim that evidence.
