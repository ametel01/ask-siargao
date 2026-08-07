# Authentication and Payments Production-Readiness Assessment

Assessment captured on 2026-08-07. This is the primary historical assessment that informed
[`PLAN.md`](../../../PLAN.md). Links to repository files were normalized for durable in-repository
use. The plan, domain glossary, and ADRs contain the subsequently approved decisions.

## Executive assessment

Ask Siargao is **not production-ready for authentication or payments yet**.

The foundations are promising:

- Clerk sign-in/sign-up is integrated.
- Most authenticated APIs enforce ownership at the data boundary.
- Clerk and Stripe webhook signatures are verified.
- Trip Pass has a local order, entitlement, usage, and idempotency model.
- The focused auth/payment suite passed 92 tests.

However, there is one payment defect that would likely stop the entire production flow, plus
correctness gaps around identity synchronization, refunds, disputes, concurrent purchases, account
deletion, monitoring, and real end-to-end testing.

The recommendation was:

> Keep Clerk for identity and direct Stripe Checkout for the current Trip Pass. Do not migrate the
> present payment product to Clerk Billing.

## Can Clerk handle the payments?

Clerk Billing can manage recurring user or organization subscriptions and authorize features
through Clerk. It uses Stripe for processing, but plans and subscriptions live in Clerk rather than
Stripe Billing.

It is a poor fit for the current product:

| Product model | Recommended system |
| --- | --- |
| Current $9.99, 14-day, 150-answer Trip Pass | Direct Stripe Checkout |
| Monthly or annual Ask Siargao membership | Clerk Billing could be evaluated |
| Internal answer allowance and expiration | Keep in the Ask Siargao database |
| Refunds, disputes, reconciliation | Direct Stripe lifecycle integration |

The current Trip Pass is a one-time, time-limited purchase with an internal usage meter. Clerk
Billing currently focuses on recurring subscriptions. It also has material production limitations,
including no Clerk-managed refunds, USD-only billing, no tax/VAT handling, no 3DS, and no
usage-based billing. See
[Clerk Billing overview](https://clerk.com/docs/guides/billing/overview) and
[Clerk Billing](https://clerk.com/billing).

Even with Clerk Billing, the 150-answer allowance would still need the existing local entitlement
system. Migrating now would add a second entitlement authority without removing the hard parts.

## Highest-priority blockers

### P0 — Production payment traffic will fail closed

The global rate limiter is initialized with an in-memory store. In production, the implementation
correctly rejects use of a non-shared store—but nothing initializes the Redis-backed replacement.

Both checkout and verified Stripe webhook delivery use this limiter:

- [`rate-limit.ts`](../../../src/server/security/rate-limit.ts)
- [checkout route](../../../src/app/api/me/trip-pass/checkout/route.ts)
- [Stripe webhook route](../../../src/app/api/stripe/webhook/route.ts)

Likely result: checkout and webhook requests return `429` in production even when `REDIS_URL`
exists. A customer could pay through an already-created Stripe session but never receive access.

Required fix: guarantee Redis limiter initialization before handling requests, add a production-mode
integration test, and reconsider IP throttling for already signature-verified Stripe events.

### P0 — The repository explicitly says the payment launch is blocked

The launch-proof artifact has `launchReady: false`, with finance, legal, Redis, Stripe, webhook,
monitoring, backup, reviewer, and sandbox lifecycle evidence still blocked:

- [`trip-pass-launch-proof.ts`](../../../src/server/qa/trip-pass-launch-proof.ts)
- [recorded launch evidence](../../../docs/evaluations/trip-pass-launch-proof-2026-07-14.json)

`TRIP_PASS_CHECKOUT_ENABLED` should remain disabled until these checks are replaced with real
evidence.

### P0 — The normal lint release gate is red

`bun run lint` currently fails because Biome includes tracked files under
`.agents/skills/impeccable`, producing 864 errors and 818 warnings. A targeted Biome check over
application and test code passed, so this appears to be lint scope/configuration rather than
hundreds of application defects. Nevertheless, CI runs the failing command, so the repository
cannot pass its declared release gate.

## Authentication findings

### 1. Partial Clerk configuration silently produces a broken deployment

Client auth is enabled by the publishable key alone, while server auth requires both the publishable
and secret keys. With partial configuration, the UI can show Clerk while middleware is bypassed and
APIs return `401`.

Evidence:

- [`clerk-config.ts`](../../../src/features/auth/clerk-config.ts)
- [`layout.tsx`](../../../src/app/layout.tsx)
- [`proxy.ts`](../../../src/proxy.ts)

Production should fail startup unless the complete Clerk configuration is present. Retain an
explicit auth-disabled mode only for local tests.

### 2. Session requests can corrupt webhook-synchronized identity

Every authenticated request runs the same broad user upsert as a Clerk lifecycle webhook. Standard
Clerk session claims do not necessarily contain email, name, or image, so a request can replace
accurate identity data with a synthetic email and null fields.

The upsert also clears `deleted_at`, allowing a lingering session or stale event to resurrect a
deleted local identity:

- [`clerk-users.ts`](../../../src/server/auth/clerk-users.ts)

Session fallback should only create a minimal row when none exists or update `last_seen_at`. Verified
Clerk webhooks should exclusively own identity fields and deletion state.

### 3. Clerk webhook processing is not order-safe

`user.created` and `user.updated` do not compare Clerk timestamps before overwriting existing data.
A delayed older event can revert newer profile information, and an update arriving after deletion
can clear the tombstone.

Stripe also documents that webhook ordering is not guaranteed; provider integrations should assume
the same distributed-delivery realities:
[Stripe webhook ordering](https://docs.stripe.com/webhooks?lang=node).

Add duplicate, reverse-order, stale-update, and update-after-delete tests.

### 4. The declared protected-route policy is not enforced

There is a tested route classifier, but `proxy.ts` runs bare `clerkMiddleware()` without calling
`auth.protect()` based on that policy:

- [route policy](../../../src/server/auth/clerk-route-policy.ts)
- [`proxy.ts`](../../../src/proxy.ts)

Most current APIs protect themselves, which is good, but a future route can be accidentally exposed
while classifier tests remain green. Middleware protection should provide the outer boundary while
handlers retain resource-level authorization.

Configure Clerk's `authorizedParties` as part of this work to restrict accepted production origins,
following [Clerk middleware guidance](https://clerk.com/docs/reference/nextjs/clerk-middleware).

### 5. Clerk account deletion does not delete application data

A Clerk `user.deleted` event anonymizes only the identity-cache row. Profiles, chat history, saved
trips, preferences, and public shares remain:

- [Clerk deletion handler](../../../src/server/auth/clerk-users.ts)
- [database schema](../../../src/server/db/schema.ts)

Define a table-by-table retention policy. Product data should be erased or anonymized and public
shares invalidated, while legally required payment records should be retained in an explicitly
anonymized form.

## Payment correctness findings

### 1. Refund and dispute behavior contradicts the published policy

Every `refund.created` or `charge.refunded` event revokes the pass without checking whether the
refund is full, partial, pending, failed, or cancelled. Both dispute-created and dispute-closed
events are mapped to the same terminal disputed state:

- [`webhook-application.ts`](../../../src/server/trip-pass/webhook-application.ts)
- [public refund policy](../../../src/features/trip-pass/public-copy.ts)

A partial refund can therefore remove all access, and a dispute won by the merchant can never
restore access. Stripe explicitly supports partial refunds:
[Stripe refund documentation](https://docs.stripe.com/refunds?dashboard-or-api=api).

Implement a real state machine for full/partial refund and dispute open/won/lost states.

### 2. Revocation is not atomic or replay-safe

The order is updated first and the pass second, outside a single transaction. If the second update
fails, a retry sees the order already changed and returns “duplicate,” leaving the pass active
permanently:

- [revocation application](../../../src/server/trip-pass/webhook-application.ts)

Order state, pass state, and a unique webhook-event ledger must be updated in one database
transaction.

### 3. Concurrent purchases can charge twice without additive value

Checkout performs a check-then-insert without locking or a database invariant. Active users can
still be offered checkout, and simultaneous requests can generate multiple payable sessions:

- [`commerce.ts`](../../../src/server/trip-pass/commerce.ts)
- [order schema](../../../src/server/db/schema.ts)
- [entitlement selection](../../../src/server/trip-pass/entitlement.ts)

Because only one active pass is selected, two purchases do not necessarily provide two allowances.
Block purchases for active passes until stacking semantics exist, and serialize checkout creation
per user/product.

### 4. Reconciliation and diagnostics are not operational

The documented admin diagnostics page renders sample data:

- [admin diagnostics](../../../src/app/admin/diagnostics/page.tsx)

The reconciler inspects local records but does not compare them with current Stripe state. A lost
webhook therefore has no automated recovery path. Production needs live, redacted diagnostics,
scheduled Stripe comparison, alerting for aging pending orders, and an audited repair/replay
operation.

### 5. A second legacy payment product remains exposed

The older audit payment flow is separate from Trip Pass, unauthenticated, and internally
inconsistent: intake does not persist the request that checkout later expects.

This flow should be removed or firmly feature-gated before launch. Supporting two payment
architectures doubles the failure and support surface.

## Recommended production-readiness sequence

1. **Keep commerce disabled**
   - Keep `TRIP_PASS_CHECKOUT_ENABLED=false`.
   - Decide that direct Stripe is the single launch payment authority.
   - Retire or isolate legacy audit checkout.
2. **Fix authentication correctness**
   - Enforce complete production Clerk configuration.
   - Add middleware protection and `authorizedParties`.
   - Separate session presence from authoritative identity synchronization.
   - Make webhook updates monotonic and tombstone-safe.
   - Implement the account-deletion retention workflow.
3. **Fix payment correctness**
   - Initialize the Redis limiter.
   - Add a durable Stripe event ledger.
   - Make entitlement transitions transactional.
   - Implement refund/dispute state transitions.
   - Prevent overlapping or concurrent purchases.
4. **Add production operations**
   - Real sanitized Clerk and Stripe webhook telemetry.
   - Alerts for webhook failures and aging pending orders.
   - Live reconciliation against Stripe.
   - Document replay, refund, dispute, account deletion, key rotation, and rollback procedures.
5. **Prove the complete flow**
   - Add a Clerk-enabled Playwright project using an isolated Clerk test instance; the current
     Playwright server explicitly clears Clerk keys and mocks authenticated APIs.
   - Test sign-up, sign-in, persistence, sign-out, redirects, account management, ownership denial,
     and deletion.
   - Test Stripe checkout through verified webhook activation, duplicate and reversed events,
     partial/full refunds, disputes won/lost, concurrent checkout, Redis failure, and reconciliation.
   - Run against real PostgreSQL in addition to PGlite.
6. **Complete external launch review**
   - Verify Clerk production instance, custom domain, production keys, OAuth credentials, session/MFA
     policy, webhook endpoint, and signing secret. See
     [Deploying Clerk to production](https://clerk.com/docs/guides/development/deployment/production).
   - Verify Stripe account activation, webhook subscriptions, tax/legal position, refund policy,
     alert delivery, backup restoration, and restricted Operator access.
   - Close the recorded independent review and approval blockers before enabling checkout.

## Verification performed

- `bun run typecheck --incremental false` — passed.
- 92 focused authentication and payment tests — passed.
- Targeted Biome check over application/test/config files — passed.
- `bun run lint` — failed due to the tracked `.agents/skills/impeccable` lint scope.

The assessment did not inspect secret values, change files, run live transactions, or validate the
external Clerk, Stripe, Redis, DNS, or hosting dashboards. Those external checks remain mandatory
release evidence.
