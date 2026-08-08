# Launch Trip Pass

This runbook begins only after the candidate is merged to `main`. It separates engineering
readiness from human launch authorization. Following it does not itself enable checkout.

## Launch contract

The as-built product is `siargao_trip_pass_14d_v2`: a one-time USD 9.99 Checkout payment for a
14-day/336-hour pass and 150 successful `chat_message` answers. Stripe owns amount and currency;
the local ledger owns access and meter balance. Stripe API `2026-07-29.dahlia` and normalized event
schema `2` are the accepted payment contract.

`TRIP_PASS_CHECKOUT_MODE` is the only rollout control: `off`, `canary`, or `on`. Empty or malformed
configuration resolves to `off`. Canary requires an explicit immutable account allowlist. The
release manifest and this PR keep checkout `off`.

## 1. Open the launch issue

An eligible human creates a dedicated GitHub launch issue for one full `main` SHA. Record:

- the immutable SHA and deployment URL bound to that SHA;
- the SHA-qualified engineering manifest and checksum;
- the complete ordered migration ledger fingerprint;
- exact CI and protected Clerk/Stripe release-candidate run links;
- legal, privacy, finance, security, Operator, monitoring, backup/restore, and rollback sign-offs;
- the intended rollout mode, canary accounts if applicable, observation window, and named rollback
  owner.

Do not copy secrets, emails, Checkout URLs, payment identifiers, webhook payloads, or database URLs
into the issue.

## 2. Validate gates and provider receipts

Follow [Run Release-Candidate QA](run-release-candidate-qa.md). Reject evidence for another SHA,
another migration set, a mutable deployment alias that changed mid-run, a production provider
resource, or a receipt that was not executed. Verify account lifecycle, signed webhooks, payment
ordering, refund/dispute convergence, Refund Review, Paid After Closure, paid-answer settlement,
and the exact 30-minute Checkout reservation expiry boundary.

## 3. Verify operations before authorization

Confirm scheduler-neutral workers are invoked with bounded batches and database-time leases. Check
scrubbed Sentry delivery, Redis paid-path fail-closed behavior, `/admin/diagnostics`, reconciliation,
repair preview/idempotency, account-closure retry, privacy restore guard, and tested database
backup/restore. Raw provider payload retention is prohibited.

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

## 4. Human authorization and rollout

A non-author human reviews every issue checkbox and records the decision. Engineering readiness is
necessary but is not launch authorization. Only after approval may the named Operator change
`TRIP_PASS_CHECKOUT_MODE`, first to the approved canary when one is required. Observe payment/access
drift, webhook retry age, refund/dispute state, closure obligations, meter exhaustion, cost budgets,
and Sentry pages before any later `on` decision.

## Roll back

Set `TRIP_PASS_CHECKOUT_MODE=off` and redeploy. Existing paid access, refunds, disputes, closure
operations, inbox rows, usage events, and audit evidence continue forward; do not delete them or
reverse migrations. Reconcile authoritative Stripe facts, open Findings, and use only the
allowlisted fresh-MFA Operator repair path. Record the rollback and follow-up evidence in the same
dedicated GitHub launch issue.
