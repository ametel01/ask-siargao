# Launch Trip Pass

This runbook begins only after the Release Candidate is merged to trusted `main`, deployed to the
protected environment, and bound to current Release Evidence. Foundation Gate Status, Production
Readiness, and Launch Authorization are separate conclusions. Following this runbook does not itself
enable checkout.

The [2026-08-09 production-readiness assessment](../explanation/whole-application-production-readiness-assessment-2026-08-09.md)
records the historical evidence and decisions behind this policy.

## Launch contract

The as-built product is `siargao_trip_pass_14d_v2`: a one-time USD 9.99 Checkout payment for a
14-day/336-hour pass and 150 successful `chat_message` answers. Lemon Squeezy owns the merchant,
transaction, receipt, amount, currency, and refund facts; the local ledger owns access and meter
balance. The accepted contract is one immutable Store/Variant, signed `order_created` and
`order_refunded` facts, and normalized Payment Event Receipt fingerprints.

`TRIP_PASS_CHECKOUT_MODE` is the only rollout control: `off`, `canary`, or `on`. Empty configuration
resolves to `off`. Deployment validation must reject malformed values; if an invalid value is still
encountered at runtime, checkout must resolve to `off`, page the Operator, and preserve free chat.
Do not authorize a candidate until code, tests, and deployment checks satisfy this contract. Canary
requires an explicit immutable account allowlist. The release manifest and repository evidence keep
checkout `off`.

## 1. Open the launch issue

An Evidence Owner creates a dedicated GitHub launch issue for one full trusted-`main` SHA. Record:

- the immutable SHA and deployment URL bound to that SHA;
- the SHA-qualified engineering manifest and checksum;
- the complete ordered migration ledger fingerprint;
- exact CI and protected Clerk/Lemon Squeezy release-candidate run links;
- legal, privacy, finance, security, Operator, monitoring, backup/restore, and rollback sign-offs;
- the intended rollout mode, canary accounts if applicable, observation window, and named rollback
  owner.
- the Evidence Owner, independent Launch Approver, exposure Operator, security/privacy incident
  owner, and cost owner.

Do not copy secrets, emails, Checkout URLs, payment identifiers, webhook payloads, or database URLs
into the issue.

## 2. Validate gates and provider receipts

Follow [Run Release-Candidate QA](run-release-candidate-qa.md). Reject evidence for another SHA,
another migration set, a mutable deployment alias that changed mid-run, a production provider
resource, or a receipt that was not executed. Verify account lifecycle, signed webhooks, payment
ordering, refund/dispute convergence, Refund Review, Paid After Closure, paid-answer settlement,
and the exact 30-minute Checkout reservation expiry boundary.

## 3. Verify operations and recovery before authorization

Confirm scheduler-neutral workers are invoked with bounded batches and database-time leases. Check
scrubbed Sentry delivery, Redis paid-path fail-closed behavior, `/admin/diagnostics`, reconciliation,
repair preview/idempotency, account-closure retry, privacy restore guard, and tested database
backup/restore. Raw provider payload retention is prohibited.

Require a successful database restore drill from the previous 30 days and an exercised application
rollback before first authorization and at least quarterly thereafter. Confirm a health/readiness
surface, named signal owners, and tested alert routes. Provider QA must match the exact deployed SHA
and be rerun after relevant Clerk or Lemon Squeezy configuration changes.

Exercise the deployed scheduler adapters with bounded invocations and verify only scrubbed counts:

```sh
bun run operations:worker -- --enqueue --cycle-key=<opaque-cycle> --enqueue-limit=100 --batch=25 --lease-seconds=60
bun run privacy:closure-worker
bun run payments:closure-refund-worker
bun run privacy:restore-guard
```

The general worker covers `account_closure`, `pending_stripe_event`,
`paid_after_closure_refund`, `retention_purge`, and `commerce_reconciliation`. Provider-specific
credentials belong only to the concrete handlers that need them. A scheduler must retry due work;
it must not run overlapping global release-candidate mutations.

Run reconciliation read-only before considering a mutation:

```sh
bun run operations:reconcile -- --order=<opaque-local-order-id>
```

## 4. Authorize the Checkout Canary

A Launch Approver reviews every issue checkbox and records the decision. The Launch Approver cannot
be the candidate author, Evidence Owner, or exposure Operator. Authorization expires after 24 hours
if unused and is revoked by a new candidate, expired evidence, or a newly discovered non-waivable
risk. Privacy deletion, authentication bypass, money/access divergence, and unrecoverable data-loss
risks cannot be waived.

Checkout Canary is mandatory. Only after authorization may the named Operator change
`TRIP_PASS_CHECKOUT_MODE` to `canary`. Observe it for seven consecutive days and require:

- three successful real-money internal Trip Pass Orders across distinct accounts;
- one successful full refund;
- zero unresolved money/access mismatches;
- no missed page-worthy alert;
- every worker remaining within its documented cadence; and
- no high-severity incident.

Observe payment/access drift, webhook retry age, refund/dispute state, closure obligations, meter
exhaustion, cost budgets, and Sentry pages throughout the window.

## 5. Authorize General Paid Availability

Changing `TRIP_PASS_CHECKOUT_MODE` to `on` requires a new Production Readiness determination and a
separate Launch Authorization. Attach the completed canary evidence, confirm the operational system
can support uncapped eligible checkout, and recheck every non-waivable risk before the named Operator
changes exposure.

## Roll back

Set `TRIP_PASS_CHECKOUT_MODE=off` and redeploy. Existing paid access, refunds, disputes, closure
operations, inbox rows, usage events, and audit evidence continue forward; do not delete them or
reverse migrations. Reconcile authoritative Lemon Squeezy facts, open Findings, and use only the
allowlisted fresh-MFA Operator repair path. Record the rollback and follow-up evidence in the same
dedicated GitHub launch issue.

Rollback immediately for an authentication, privacy, money/access, or data-integrity incident; an
expired or invalid authorization; an unresolved high-severity incident; a missed page-worthy alert;
or workers falling outside their required cadence.
