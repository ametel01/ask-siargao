# Trip Pass Reconciliation and Repair Reference

Live reconciliation observes authoritative provider payment facts (Lemon Squeezy for launched
Orders, Stripe only for retained historical evidence) and records opaque Findings. The production
worker also routes verified Lemon Squeezy facts through the durable receipt and payment-lifecycle
boundary; it never applies provider state directly. Repair is a separate same-origin Operator API
action.

This is the only module called reconciliation. `reconcileLiveCommerce` in
`src/server/operations/live-reconciliation.ts` owns the provider-authoritative comparison and its
durable Finding lifecycle.

## Authority and ordering

The configured payment provider is the authority for payment state, amount, and currency. The Ask
Siargao ledger is the authority for access. For every order, the authoritative provider lookup completes before the
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

Neither path applies an Operator repair. The production worker can apply a verified provider fact
through the same receipt boundary as a webhook, while the direct reconciliation command remains
read-only with respect to commerce. Output is limited to redacted counts and opaque Finding
references, never full Checkout URLs, provider payloads, emails, or provider object IDs.

The producer emits one durable `risk:<cycle>:<order>` task for each due active or nonterminal Order
and one `daily:<cycle>:<order>` task for each terminal Order, including refunded Orders. Risk
observations become due after three minutes and terminal observations after 24 hours. A production
cron invocation pages newly due reconciliation work only while at least 46 seconds remain for the
worker; unproduced due Orders remain eligible for the next every-minute invocation. It then
concurrently claims at most 50 reconciliation tasks, 25 tasks from each lifecycle-recovery family,
and 25 retention tasks. Every producer query and insert receives a cancellable database deadline;
production stops all producer families while the 46-second worker reserve remains. Claims use the
same statement cancellation and release a batch if it commits too late to start safely. Provider
clients receive the worker abort signal and have a 45-second transport timeout. The cron worker
aborts provider work 15 seconds before its internal deadline, so a task admitted at the nine-second
producer boundary has at most 31 seconds of provider runtime and still reserves 15 seconds to
persist the fact and complete its durable task. Natively cancellable requests stop on abort. A
retained SDK request that cannot be cancelled keeps its durable lease until the transport settles;
its five-minute lease also exceeds the bounded provider transports, so a deadline cannot expose it
to an overlapping retry.

Checkout creation enforces a safe launch population of 50 Orders in the risk statuses `pending`,
`checkout_created`, `paid`, or `disputed`. That fits in one every-minute reconciliation batch, and
risk Orders become eligible after three minutes. This reserves one minute of cron alignment, the
45-second provider deadline, and application overhead inside the five-minute target. The count and
insert are serialized by a transaction-level advisory lock; production lock errors fail checkout
closed. Expired Lemon Squeezy checkouts remain fenced for a five-minute settlement grace and while
a durable payment receipt or return lookup is pending. Only older Orders with no accepted,
captured, or pending payment evidence converge to `expired` before capacity is counted, allowing a
deliberate retry without weakening the risk bound. Increasing the 50-Order bound requires
production evidence for correspondingly scalable worker capacity; it is not a configuration-only
change.

The checkout-return worker durably consumes its single exact-Order provider access before making
the request. An ambiguous or interrupted lookup is never submitted again under that recovery path;
webhooks and the general reconciliation worker remain the convergence authority.

## Exact finding scope

The current comparison emits only these four Finding kinds:

- `paid_without_pass`: the provider reports `paid` and the local order has no pass.
- `access_without_payment`: the provider reports `unpaid` or `pending` while local access exists.
- `payment_state_mismatch`: the authoritative amount or currency differs from the local order.
- `pending_payment_stale`: the provider still reports `pending` at least 30 minutes after local creation.

Refund and dispute lifecycle application, webhook retry, Account Closure ordering, and paid-answer
usage have their own handlers and diagnostics. They are not findings produced by this comparison.
If provider lookup is ambiguous or unavailable, reconciliation fails and retries instead of
inventing a Finding from incomplete provider truth.

## Trip Pass diagnostics

`buildTripPassDiagnostics` in `src/server/trip-pass/diagnostics.ts` is a separate, read-only
diagnostic module. The admin diagnostics view uses it for Usage Meter integrity, stale reservations,
paid-answer linkage, and privacy-safe inspection of purged aggregates. Its support lookup accepts an
opaque order, pass, or Account reference and returns redacted status and meter summaries.

The diagnostic snapshot has no `mode`, mutation confirmation flag, planned actions, provider
payment comparison, or environment-health payload. A diagnostic issue is not a Reconciliation
Finding, its severity is never a claim that it is repairable, and it cannot be passed directly to
the Repair API. Repair remains available only for a durable open Finding through the workflow
below.

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

## Operator refund API

Normal refunds are not Reconciliation Findings. An allowlisted Operator uses the dedicated panel on
`/admin/diagnostics`, backed by `POST /api/admin/trip-pass/refunds`:

1. Preview an opaque Order ID with `full_refund` or `accept_partial_refund`.
2. Reverify with fresh Clerk MFA and execute the unchanged preview with confirmation exactly
   `APPLY REFUND`, a reason code, and a new idempotency key.
3. The server records `operator_refund_actions`. A full refund queues a durable provider operation;
   accepting a partial refund cancels the deadline operation while preserving access and meter use.

Provider-confirmed refund facts remain the only authority that revokes access.
