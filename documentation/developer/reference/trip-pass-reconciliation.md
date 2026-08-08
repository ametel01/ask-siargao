# Trip Pass Reconciliation and Repair

Reconciliation and repair are separate authority boundaries.

`reconcileLiveCommerce()` in `src/server/operations/live-reconciliation.ts` loads local Order and
access state, completes authoritative provider lookup without a database transaction, compares the
facts, and then records only opaque `finding_*` records. It never transitions an Order, creates a
Trip Pass, changes a Usage Meter, or calls a provider mutation. Historical `mode: "repair"` and
`confirmMutation` inputs to `reconcileTripPassState()` remain accepted for rolling-deployment
compatibility but are ignored; every flag combination is detect-only.

After each provider response, reconciliation allocates a database-authored monotonic observation
sequence without holding a transaction or lock across the provider call. The apply transaction then
locks the Order and advances its observation row only when the token is newer than the stored token.
Older healthy or mismatch responses cannot resolve, reopen, or page after a newer observation.

Each mismatch has a canonical opaque incident key derived from constrained mismatch fields and its
local record identity, never from the reconciliation run. An unchanged mismatch updates the same
Finding and lifecycle. A clean comparison resolves it; recurrence reopens the same opaque Finding
with the next lifecycle number. Sentry delivery keys include that opaque incident plus lifecycle, so
retries do not repage while a genuine recurrence can page again.

## Provider-neutral adapter contract

Protected provider lanes inject `AuthoritativeCommerceReader`. The reader receives transient
Checkout Session or Payment Intent lookup inputs; provider IDs do not appear in returned traces,
Finding views, diagnostics, logs, or alert payloads. `OperationEventRecorder` records only ordered
operation name/result pairs. This lets tests prove `authoritative_payment_lookup` completes before
`record_reconciliation_findings` begins without retaining provider payloads.

## Diagnostics

`/admin/diagnostics` reads live `operational_findings` and incomplete
`operational_worker_tasks`. It shows only opaque Finding/Task IDs, constrained kind/status/impact
codes, attempt counts, and sanitized error codes. It never renders local entity references, Clerk
IDs, emails, prompts, IPs, precise locations, raw webhooks, cookies, payment object IDs, or provider
payloads.

Production read access requires a signed-in Clerk Account whose immutable Account ID is in the
server-only `OPERATOR_ACCOUNT_IDS` allowlist. `ADMIN_ACCESS_TOKEN` is local read-only compatibility
and is rejected in production.

## Repair Actions

Use `previewRepairAction()` before `executeRepairAction()`. Execution requires all of:

- the same opaque Finding ID and action type as the preview;
- the preview digest, so changed state forces another human review;
- literal confirmation `APPLY REPAIR`;
- a constrained reason code and an idempotency key;
- a named allowlisted Operator Account;
- Clerk `second_factor` reverification age 0–5 minutes.

The transaction locks the Finding, rechecks the preview, applies one provider-neutral local repair,
stores the Operator Account ID, hashed idempotency key, reason, sanitized before/after states and
database time, and resolves the Finding. Repeating the key returns the original audited result.
The audit also stores a canonical command hash over Finding, action, reason, and preview digest.
An exact replay returns the original result; reuse of the same Operator/key for a different command
fails with `repair_idempotency_mismatch` before target mutation. Provider calls are not permitted
inside a Repair Action transaction.

Payment/access repairs add a prepare phase immediately before the transaction. It retrieves the
current authoritative Payment Intent fact outside database locks, including refund/dispute state,
then carries a bounded proof into the transaction. After locking, execution recomputes the local
preview and verifies the provider/local identity, amount, currency, and allowed payment state still
match. Refunded, disputed, reversed, mismatched, or stale proof aborts without target mutation or an
applied audit row.

Sensitive action classes are closed allowlists, not patch requests. A manual commerce transition
can only fail an ungranted pending Order whose finding proves authoritative payment terms mismatch.
A goodwill recovery can only restore the missing grant for a paid, owned, ungranted Order with a
provider-application-failure Finding and still obeys Family → Account locking/no stacking. Account
recovery only requeues a failed Account Closure cleanup operation; it never clears a tombstone or
resurrects identity.

## Durable workers

`runOperationalWorker()` claims `operational_worker_tasks` with database-time leases and
`FOR UPDATE SKIP LOCKED`, invokes an injected task handler outside the claim transaction, and fences
success/retry updates by lease token. Crashes leave work reclaimable after lease expiry. Repeated
failures remain visible and can invoke a scrubbed Sentry warning/page callback. Supported task kinds
are Account Closure, Pending Stripe Event, Paid After Closure refund, retention purge, and commerce
reconciliation. `bun run operations:enqueue -- --task=<kind-or-all>` discovers due obligations and
enqueues stable task/target identities. `bun run operations:worker -- --task=<kind-or-all>` drains
already-queued work. An external scheduler can perform both phases in one bounded invocation with
`bun run operations:run -- --task=<kind-or-all> --cycle-key=<opaque-cycle>`; repeating the same
cycle key cannot duplicate work. `--batch`, `--enqueue-limit`, and `--lease-seconds` bound one
invocation. No scheduler vendor or cadence is selected by engineering.

Both success and retry transitions require the matching token and an unexpired database-time lease;
an expired worker can neither complete nor reschedule work after takeover becomes eligible. Repeated
failure alerts use a one-way opaque task key, stable across attempts but distinct across tasks.

## Alert ownership

Sentry owns operational delivery. `deliverOperationalAlertOnce()` uses a durable unique alert key,
database-time delivery lease, expired-claim recovery, and a strictly allowlisted payload of Finding
ID, impact, operation, and error code. Provider delivery happens outside database transactions;
success and failure updates are fenced by the delivery token and unexpired lease. Confirmed
high-impact payment/access/privacy/Redis mismatches page once. Lower-impact conditions warn or
create tickets. PostHog remains timeout-bounded analytics only; its success or failure cannot change
commerce, access, closure, reconciliation, repair, or worker state.

The Sentry `event_id` is the valid 32-hex-character digest of the opaque alert lifecycle key. Crash
reclaim and ambiguous transport retry therefore reuse one provider idempotency identity, while a new
incident lifecycle receives a different identity.
