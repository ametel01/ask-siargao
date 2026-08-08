# Trip Pass Reconciliation and Repair

Reconciliation and repair are separate authority boundaries.

`reconcileLiveCommerce()` in `src/server/operations/live-reconciliation.ts` loads local Order and
access state, completes authoritative provider lookup without a database transaction, compares the
facts, and then records only opaque `finding_*` records. It never transitions an Order, creates a
Trip Pass, changes a Usage Meter, or calls a provider mutation. Historical `mode: "repair"` and
`confirmMutation` inputs to `reconcileTripPassState()` remain accepted for rolling-deployment
compatibility but are ignored; every flag combination is detect-only.

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
Provider calls are not permitted inside a Repair Action transaction.

## Durable workers

`runOperationalWorker()` claims `operational_worker_tasks` with database-time leases and
`FOR UPDATE SKIP LOCKED`, invokes an injected task handler outside the claim transaction, and fences
success/retry updates by lease token. Crashes leave work reclaimable after lease expiry. Repeated
failures remain visible and can invoke a scrubbed Sentry warning/page callback. Supported task kinds
are Account Closure, Pending Stripe Event, Paid After Closure refund, retention purge, and commerce
reconciliation. Existing CLI entrypoints and thin authenticated adapters inject their provider
clients; no scheduler vendor or cadence is selected by engineering.

## Alert ownership

Sentry owns operational delivery. `deliverOperationalAlertOnce()` uses a durable unique alert key,
retryable failed delivery, and a strictly allowlisted payload of Finding ID, impact, operation, and
error code. Confirmed high-impact payment/access/privacy/Redis mismatches page once. Lower-impact
conditions warn or create tickets. PostHog remains timeout-bounded analytics only; its success or
failure cannot change commerce, access, closure, reconciliation, repair, or worker state.
