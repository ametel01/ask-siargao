# Plan 002: Load checkout eligibility from persisted server state

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/app/api/audit/checkout/route.ts src/server/audit/lifecycle.ts src/server/payments/stripe.ts src/server/audit/intake-service.ts src/server/db/schema.ts src/server/payments/stripe-lifecycle.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-drizzle-schema-parity.md`
- **Category**: security
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

Checkout currently trusts `status` and `checkoutEligible` from the request body. A caller can submit an arbitrary `auditRequestId` with `complete_for_payment` and create a Stripe Checkout Session without the server loading a real completeness decision. The paid audit promise depends on the server, not the browser, being the source of truth for payment eligibility.

## Current State

- `src/app/api/audit/checkout/route.ts` is the Checkout API route.
- `src/server/audit/lifecycle.ts` has pure lifecycle guards.
- `src/server/payments/stripe.ts` builds Stripe Checkout Session params.
- `src/server/db/schema.ts` already includes `auditRequests`, `auditInputs`, `auditCompletenessChecks`, and `payments`; plan 001 should make the schema complete.

Relevant excerpts:

```ts
// src/app/api/audit/checkout/route.ts:9
const checkoutRequestSchema = z.object({
  auditRequestId: z.string().min(1),
  status: z.enum(auditJobStates),
  checkoutEligible: z.boolean().optional(),
  customerEmail: z.string().email().optional(),
});
```

```ts
// src/app/api/audit/checkout/route.ts:38
const audit = createAuditLifecycleRecord({
  id: parsed.data.auditRequestId,
  state: parsed.data.status,
  checkoutEligible: parsed.data.checkoutEligible,
});
```

```ts
// src/server/audit/lifecycle.ts:72
return (
  audit.state === "complete_for_payment" && audit.checkoutEligible && audit.priceUsd === 9.99
);
```

Product constraints from docs:

- Payment is requested only after the completeness gate passes.
- Checkout is a handoff; verified Stripe webhooks are the unlock boundary.
- The completeness gate must block payment when critical inputs or accommodation match confidence are insufficient.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/payments/stripe-lifecycle.test.ts` | exit 0 |
| Route tests | `bun test src/app/api/audit/checkout/route.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/app/api/audit/checkout/route.ts`
- `src/app/api/audit/checkout/route.test.ts` (create)
- `src/server/audit/intake-service.ts`
- A new small repository/service module under `src/server/audit/` or `src/server/payments/`
- Existing payment/lifecycle tests as needed

**Out of scope**:

- Webhook persistence and generation enqueueing; that is plan 003.
- Report delivery/access; that is plan 004.
- Changing Stripe price or product metadata.
- Adding authentication/accounts.

## Git Workflow

- Branch: `advisor/002-server-side-checkout-eligibility`
- Commit message style: `fix: load checkout eligibility from server state`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Introduce a server-side audit checkout lookup boundary

Create a small service/repository function that, given `auditRequestId`, loads the stored audit request and latest completeness check/payment state. The returned shape should be convertible into `AuditLifecycleRecord` without trusting client state.

If the repo does not yet have writable persistence helpers for audit intake, add the smallest testable abstraction needed for checkout:

- `getCheckoutAuditState(auditRequestId)` for route use
- a test-only or in-memory implementation only if full DB persistence is not yet wired

Prefer a real database-backed implementation if the app already has a usable `DATABASE_URL` in the target environment. Do not invent an account system.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 2: Narrow the checkout request contract

Change `checkoutRequestSchema` so the client can send only:

- `auditRequestId`
- optional `customerEmail`

Remove `status` and `checkoutEligible` from accepted input. If unknown keys are currently allowed, make the schema reject or strip them intentionally; tests must prove spoofed `status` cannot affect checkout.

**Verify**: `bun test src/app/api/audit/checkout/route.test.ts` -> expected failures until tests are added and implementation completes.

### Step 3: Load state server-side before creating Stripe Checkout

In `src/app/api/audit/checkout/route.ts`, load the audit/completeness state using the service from Step 1. Construct `AuditLifecycleRecord` from persisted state only. Keep using `createCheckoutSessionForAudit`, so `assertCanStartCheckout` remains the final lifecycle guard.

Expected behavior:

- missing audit -> 404 or 409 with stable error code
- incomplete audit -> 409 `checkout_not_available`
- complete and eligible audit -> creates Stripe Checkout Session
- client-supplied status, if present, has no effect

**Verify**: `bun test src/app/api/audit/checkout/route.test.ts` -> exit 0.

### Step 4: Add route-level regression tests

Create `src/app/api/audit/checkout/route.test.ts` covering:

- rejects malformed JSON/schema failures
- rejects an audit that is not found
- rejects an audit whose persisted state is `needs_user_input`
- rejects spoofed `status: "complete_for_payment"` when persisted state is incomplete
- creates Checkout only for persisted `complete_for_payment` and `checkoutEligible: true`

Use synthetic `Request` objects and mock the service/Stripe boundary. If mocking ES modules is awkward in Bun, factor the route's core logic into an exported function that accepts dependencies, and keep the route wrapper thin.

**Verify**: `bun test src/app/api/audit/checkout/route.test.ts` -> exit 0.

### Step 5: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Model route tests after `src/server/payments/stripe-lifecycle.test.ts` for lifecycle assertions and `src/server/security/security.test.ts` for boundary behavior. The key regression test is: a request body that lies about `status` and `checkoutEligible` must still fail when persisted server state is incomplete.

## Done Criteria

- [ ] Checkout API no longer accepts or trusts client-supplied status or eligibility.
- [ ] Checkout eligibility is loaded from server state.
- [ ] Spoofed checkout route tests exist and pass.
- [ ] Existing Stripe lifecycle helper tests still pass.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- There is no feasible persisted audit/completeness source after plan 001 lands.
- The fix requires changing Stripe pricing, webhook semantics, or report delivery.
- The implementation would charge without a durable audit record.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Future checkout changes should keep client input to identity/contact fields only. Reviewers should reject any reintroduction of client-controlled audit lifecycle state.

