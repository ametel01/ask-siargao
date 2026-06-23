# Plan 003: Apply verified Stripe webhooks to the audit lifecycle

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/app/api/stripe/webhook/route.ts src/server/payments/stripe.ts src/server/audit/lifecycle.ts src/server/jobs/audit-jobs.ts src/server/db/schema.ts src/server/payments/stripe-lifecycle.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-server-side-checkout-eligibility.md`
- **Category**: bug
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The webhook route verifies Stripe signatures and extracts payment data, but it does not apply that payment to the audit lifecycle. Real users can pay and still never get generation enqueued. This plan connects the verified webhook boundary to durable payment event persistence, audit state transition, and audit generation enqueueing.

## Current State

- `src/app/api/stripe/webhook/route.ts` verifies payloads.
- `src/server/payments/stripe.ts` extracts `VerifiedCheckoutPayment`.
- `src/server/audit/lifecycle.ts` has `handleVerifiedPayment`, but the route does not call it.
- `src/server/jobs/audit-jobs.ts` creates in-memory job records.

Relevant excerpts:

```ts
// src/app/api/stripe/webhook/route.ts:25
const event = await verifyStripeWebhookPayload({
  payload,
  signature,
  webhookSecret: stripeWebhookSecretFromEnv(),
});
const payment = extractVerifiedCheckoutPayment(event);
```

```ts
// src/app/api/stripe/webhook/route.ts:45
return Response.json({
  received: true,
  paymentEvent: buildVerifiedPaymentEventRecord({
```

```ts
// src/server/audit/lifecycle.ts:123
export function handleVerifiedPayment(
  audit: AuditLifecycleRecord,
  payment: VerifiedCheckoutPayment,
```

Product constraints:

- Verified Stripe webhook events are the source of truth for paid report unlocks.
- Webhook handling must be idempotent because Stripe may retry events.
- Report generation starts only after verified payment.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/payments/stripe-lifecycle.test.ts` | exit 0 |
| Route tests | `bun test src/app/api/stripe/webhook/route.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/stripe/webhook/route.test.ts` (create)
- `src/server/payments/stripe.ts`
- A payment/audit repository or service module needed by the route
- `src/server/audit/lifecycle.ts` only if its pure helper needs a small extension for idempotency
- `src/server/jobs/audit-jobs.ts` only for queue boundary wiring

**Out of scope**:

- Full production worker backend replacement; plan 009 covers infrastructure.
- Report access control; plan 004 covers it.
- Changing the Stripe event type beyond `checkout.session.completed`.
- Refunding/canceling payments.

## Git Workflow

- Branch: `advisor/003-apply-verified-webhooks`
- Commit message style: `fix: apply verified stripe webhooks to audit lifecycle`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a webhook application service

Create a function such as `applyVerifiedCheckoutPayment(payment, rawEvent)` that:

- looks up the pending audit/payment by `auditRequestId` and `stripeCheckoutSessionId`
- rejects mismatched checkout sessions
- records the unique Stripe event ID
- transitions the audit from `awaiting_payment` to `paid` and then `generating`
- enqueues a generation job
- handles duplicate Stripe events idempotently

Use `handleVerifiedPayment` for lifecycle rules instead of duplicating state transition logic.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 2: Wire the route to the application service

In `src/app/api/stripe/webhook/route.ts`, after `extractVerifiedCheckoutPayment(event)`, call the service from Step 1. Return a small response that confirms receipt and whether the event was applied, ignored, or duplicate.

Keep these existing behaviors:

- missing `stripe-signature` returns 400
- non-checkout or unpaid events return `{ received: true, ignored: true }`
- invalid signatures return 400

**Verify**: `bun test src/app/api/stripe/webhook/route.test.ts` -> expected failures until tests are added and implementation completes.

### Step 3: Add idempotency and mismatch tests

Create `src/app/api/stripe/webhook/route.test.ts` or service tests covering:

- valid signed paid checkout event transitions audit and enqueues generation
- duplicate Stripe event does not enqueue twice
- wrong checkout session ID is rejected
- non-paid session is ignored
- invalid signature returns 400
- missing signature returns 400

Use the signed fixture pattern from `src/server/payments/stripe-lifecycle.test.ts`.

**Verify**: `bun test src/app/api/stripe/webhook/route.test.ts` -> exit 0.

### Step 4: Run gates

**Verify**:

- `bun test src/server/payments/stripe-lifecycle.test.ts` -> exit 0
- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Use `src/server/payments/stripe-lifecycle.test.ts` as the structural pattern for Stripe fixture signing. Add route or service tests that assert persisted state changes and job enqueue behavior, not only response JSON.

## Done Criteria

- [ ] Webhook route applies verified paid checkout events to audit lifecycle.
- [ ] Duplicate Stripe events are idempotent.
- [ ] Checkout session mismatch is rejected.
- [ ] Generation is enqueued only after verified payment.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Plan 002 has not established a way to persist pending checkout/payment state.
- The only possible implementation would enqueue generation without durable payment-event storage.
- You need to implement a full worker platform to complete this plan.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Reviewers should focus on idempotency and transactionality. Stripe can retry events, and a duplicate must not generate or publish multiple reports.

