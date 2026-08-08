# Trip Pass Reconciliation and Repair Reference

Reconciliation and repair are separate operations. Reconciliation is read-only and creates or
updates opaque Findings. Repair requires a named Operator, allowlist membership, fresh Clerk MFA,
a reason code, a preview, and an idempotency key.

## Authority and ordering

Stripe is the authority for money facts. The Ask Siargao ledger is the authority for access,
grants, and the single commercial `chat_message` meter. For every live reconciliation, the
authoritative Stripe lookup completes before the finding transaction begins. Tests assert this
semantic order; a broadly green test suite is not a substitute.

Run a read-only scan:

```sh
bun run operations:reconcile -- --order=<opaque-local-order-id>
```

No mutation switch exists on that command. It returns redacted counts and Finding IDs, never full
Checkout URLs, provider payloads, emails, or provider object IDs.

## Findings

The reconciler covers paid-without-pass, active-without-paid, cumulative refunds, disputes,
unsupported or ambiguous Stripe state, duplicate fact mismatches, a closure/payment race, **Paid
After Closure**, and paid-answer settlement. Uncertain access enters **Refund Review** rather than
guessing a proportional entitlement result.

Stripe webhook delivery is inbox-first and idempotent. Browser return and cancel endpoints may
refresh display state, but only signed/authoritatively retrieved provider facts can change payment
truth. Repeated and reversed delivery is applied once in the correct semantic order.

## Repair

Production repair is served through the Operator surface and durable provider-neutral operation
worker. A mutation is bound to an opaque Finding ID and the previewed before/after transition. The
worker uses database-time leases, retry fencing, and idempotency; scheduler choice and cadence live
outside application code.

```sh
bun run operations:worker -- --task=commerce_reconciliation --batch=25 --lease-seconds=60
```

Use `/admin/diagnostics` to inspect scrubbed status. If provider state is ambiguous, leave the
Finding open, preserve access fail-closed where required, and retry the provider lookup. Never edit
commerce rows directly or use a shared bearer credential to authorize repair.
