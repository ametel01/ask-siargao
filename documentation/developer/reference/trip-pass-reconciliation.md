# Trip Pass Reconciliation and Repair Reference

Live reconciliation observes authoritative Stripe payment facts and records opaque Findings. It
does not mutate Trip Pass orders, access, grants, meters, or provider state. Repair is a separate
same-origin Operator API action.

## Authority and ordering

Stripe is the authority for payment state, amount, and currency. The Ask Siargao ledger is the
authority for access. For every order, the authoritative Stripe lookup completes before the
finding transaction begins. Tests assert this semantic order; a broadly green suite is not a
substitute.

Run an explicitly scoped scan:

```sh
bun run operations:reconcile -- --order=<opaque-local-order-id>
```

Run the same commerce reconciliation through the durable scheduler-neutral queue:

The read-only `operations:worker -- --task=commerce_reconciliation` selection records Findings;
it does not select a repair executor.

```sh
bun run operations:worker -- --task=commerce_reconciliation --batch=25 --lease-seconds=60
```

Both paths are read-only with respect to commerce. The worker may claim a task and the reconciler
may insert/update reconciliation runs, observations, Findings, and scrubbed alerts; neither path
applies a repair. Output is limited to redacted counts and opaque Finding references, never full
Checkout URLs, provider payloads, emails, or provider object IDs.

## Exact finding scope

The current comparison emits only these four Finding kinds:

- `paid_without_pass`: Stripe reports `paid` and the local order has no pass.
- `access_without_payment`: Stripe reports `unpaid` or `pending` while local access exists.
- `payment_state_mismatch`: the authoritative amount or currency differs from the local order.
- `pending_payment_stale`: Stripe still reports `pending` at least 30 minutes after local creation.

Refund and dispute lifecycle application, webhook retry, Account Closure ordering, and paid-answer
usage have their own handlers and diagnostics. They are not findings produced by this comparison.
If Stripe lookup is ambiguous or unavailable, reconciliation fails and retries instead of
inventing a Finding from incomplete provider truth.

## Repair API

Mutation is available only through `POST /api/admin/repairs`, not through either reconciliation
command. The route requires same-origin execution, an authenticated Clerk Account in
`OPERATOR_ACCOUNT_IDS`, and fresh Clerk MFA for execution.

1. Send `mode: "preview"`, the opaque Finding ID, and an allowed action type. Review the returned
   before/after preview and preview digest.
2. Send `mode: "execute"` with the same Finding/action, the preview digest, confirmation exactly
   `APPLY REPAIR`, a bounded reason code, and a new idempotency key.
3. The server reauthorizes the Operator, rejects a changed preview or reused key with different
   input, applies the supported transition transactionally, and records the audit receipt.

Use `/admin/diagnostics` for scrubbed status. If provider truth is unavailable or the preview has
changed, leave the Finding open and reconcile again. Never edit commerce rows directly or use a
shared bearer credential to authorize repair.
