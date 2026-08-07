# Launch the Trip Pass

Use this guide only after the engineering completion contract in [`PLAN.md`](../../../PLAN.md) has
passed for an exact release-candidate commit. It authorizes human production work; it is not part of
engineering completion.

Production checkout starts and remains `off` unless every required approval and evidence item below
is complete. Never turn an unresolved item into an assumed default.

## What This Launch Covers

This procedure launches one direct-Stripe product:

- USD 9.99 base price, subject to the approved tax treatment;
- exactly 336 elapsed UTC hours from verified local activation;
- 150 travel answers in one Usage Meter;
- immediate card-based Stripe Checkout only;
- no stacking, extension, subscription, or Clerk Billing;
- no production legacy Trip Risk Audit checkout.

The reusable domain and architecture contract lives in [`CONTEXT.md`](../../../CONTEXT.md) and
[`docs/adr/`](../../../docs/adr/). Do not change the offer, authority boundary, or lifecycle as an
incidental launch configuration edit.

## Create the Launch Record

Create a dedicated GitHub issue as the system of record for this launch. Record:

- exact commit SHA and migration set;
- release-candidate deployment identifier;
- protected CI run and redacted launch-manifest artifact;
- Trip Pass Product version and all presented policy versions;
- owners and approval timestamps;
- redacted staging and canary evidence;
- rollback test and outcome;
- every unresolved blocker and its owner;
- final go/no-go decision and checkout-mode changes.

Do not attach secrets, environment values, raw webhook bodies, payment/customer identity, emails,
cookies, prompts, IP addresses, precise locations, provider payloads, or full Clerk/Stripe IDs. Use
opaque local Finding IDs and links to access-controlled provider dashboards when investigation
requires provider data.

## Enforce Release Identity

Protected staging, the production canary, and full production must run the same reviewed commit SHA
and migration set. Environment values may differ, but code and migrations may not.

If code or a migration changes after evidence is collected:

1. Return checkout to `off` if necessary.
2. Identify which evidence the change invalidates.
3. Rerun every affected required and protected gate on the new SHA.
4. Update the launch issue; do not edit old evidence to represent new code.

Rollback targets a previously verified release compatible with the additive schema. Never reverse
privacy, payment, entitlement, or purge records as a rollback technique.

## Record Named Approvals

All five approvals are required. One person may fill more than one role only when explicitly
authorized and recorded. A role cannot silently self-approve where repository or organization
policy requires independence.

| Approval | Required evidence |
| --- | --- |
| Engineering | Required gates green for the exact SHA; migration set and manifest reviewed |
| Security | Clerk, origins, secrets, webhook, HMAC, Operator, WAF, and repair controls approved |
| Privacy/legal | Terms, privacy, deletion, tombstone, commerce, usage, backup, and purge policies approved |
| Finance | Seller/account eligibility, price, currency, tax, fees, refund/dispute policy, and live refund owner approved |
| Operations/product owner | Sentry paging, scheduler, support, restore, canary, rollback, and final go/no-go approved |

If the intended formal approver is the pull-request author or GitHub cannot accept the decision,
record the administrative blocker and obtain the next eligible human approval. A same-author comment
does not become formal approval.

## Verify External Policy Decisions

Record approved versions and owners for all policies below. Checkout remains off until each policy
has an explicit duration or decision; `retain forever`, guessed durations, and undocumented defaults
are not acceptable.

### Product, tax, and customer terms

- Confirm that the live Stripe Price represents the approved USD 9.99 base offer.
- Record whether tax is inclusive, exclusive, or not collected for the approved seller and launch
  customer locations. Configure Stripe and public copy to match.
- Publish the product terms, refund policy, privacy notice, and support contact.
- Confirm that Checkout collects terms-of-service consent and that the Order records only policy
  version identifiers plus consent status/time.
- Approve the support refund eligibility window and exceptions. There is no self-service refund API
  or automatic proration.
- Confirm that voluntary Account Closure terminates remaining access/answers without automatic
  refund and that the confirmation UI states this clearly.

### Privacy and retention

- Approve a versioned Commerce Retention Policy and explicit duration.
- Approve the active-account per-request Usage event retention duration.
- Approve the keyed-hash Closure Tombstone retention duration.
- Approve the maximum immutable-backup lifetime and restore restrictions.
- Inventory legacy Trip Risk Audit product and payment records before migration or purge.
- Confirm the minimized Retained Commerce Evidence fields and purge schedule.
- Confirm that Erasable Product Data is not retained for analytics or model training.

### Operations

- Select a scheduler/provider and record cadence, retry configuration, alert owner, and production
  proof for closure, pending-event, Paid After Closure refund, retention purge, and reconciliation
  workers.
- Approve the server-only Operator Account-ID allowlist and removal procedure.
- Record on-call ownership for each paging condition and warning/ticket condition.
- Approve the support goodwill product version, if goodwill grants will be available.

## Verify Clerk Production Configuration

Use the Clerk production instance and dashboard. Do not copy secrets into the launch issue.

- `CLERK_AUTH_MODE=enabled` is explicit.
- Publishable key, server secret, webhook signing secret, and canonical application origin are
  complete and belong to the production instance.
- `authorizedParties` contains only the production origin and the stable protected-staging origin.
  Localhost is absent from production; wildcard `*.vercel.app` is absent everywhere.
- Ephemeral and untrusted preview deployments have authentication disabled and no Clerk secrets.
- Email one-time code and Google OAuth are enabled; password and untested methods are disabled.
- Verified email is required.
- Traveler MFA is available but optional; Operator MFA is mandatory.
- Session maximum is seven days; multi-session is disabled.
- Email delivery, OAuth credentials, production domain, and allowed redirects are proven.
- Clerk lifecycle and deletion webhooks target the verified production endpoint.
- Traveler closure requires verification no older than five minutes.
- Operator mutation requires MFA verification no older than five minutes.

Exercise sign-up, sign-in, persistence, sign-out, route/API denial, cross-account ownership denial,
profile convergence, account management, closure, webhook retry, and deletion in protected staging.

## Verify Stripe Production Configuration

Use an activated Stripe live account with approved restricted permissions.

- The integration pins the approved Stripe API version and normalized event schema version.
- The live Price ID, amount, currency, and Product version match the launch manifest.
- Checkout accepts only immediate card-based payments, including supported card wallets.
- Checkout Session expiry is explicitly 30 minutes.
- Checkout does not deliberately create or reuse Stripe Customers.
- Success/cancel URLs use the canonical production origin.
- Terms consent and policy links are visible.
- The webhook endpoint and signing secret are production-specific.
- Subscriptions include the implemented Checkout Session, payment, refund, dispute, and expiry event
  types.
- Signature failures and persistence failures return non-success; durable Pending Stripe Events are
  acknowledged and retried internally.
- Test-mode fixtures and IDs cannot enter production configuration.

Do not enable delayed-payment methods, subscriptions, extension, stacking, or Clerk Billing during
launch. Each requires a separately reviewed and tested product/lifecycle plan.

## Verify Infrastructure and Recovery

### PostgreSQL

- Production and migration credentials are separate and least-privileged.
- TLS, pool, statement timeout, backups, and point-in-time recovery match the environment reference.
- Every additive migration in the manifest is applied exactly once.
- The runtime supports transaction-scoped Account/Product Family serialization and database UTC
  time.
- A restore drill has proven that Closure Tombstones and expired-retention purges are reapplied in
  isolation before restored data can serve traffic.

### Redis

- Production uses the approved shared Redis service with TLS and an explicit eviction policy.
- Atomic quota, concurrency, reservation, idempotency, and cost semantics are proven across runtime
  instances.
- Paid requests fail closed without Redis and consume no meter unit.
- Verified Clerk/Stripe webhooks remain processable during Redis outage.
- Page operators if Redis is unavailable while checkout is `canary` or `on`.

### Monitoring and analytics

- Sentry is the operational error/alert destination and deny-by-default scrubbing is enabled.
- A synthetic production-safe failure reaches the expected Sentry project and paging route.
- Structured logs contain sanitized audit context only.
- PostHog is analytics-only; its failure cannot alter payment, access, or closure state.
- Diagnostics show live redacted facts, not fixtures or sample records.
- Reconciliation dry-run compares local state to current Stripe state without mutation.

## Confirm Required Evidence

Link the protected CI results for the exact release SHA:

```sh
bun run lint
bun run typecheck --incremental false
bun test
bun run db:migrate:test
bun run db:seed:test
bun run build
bun run test:e2e
bun run test:integration:postgres
bun run test:integration:redis
bun run verify:ci
bun run test:e2e:clerk
bun run test:smoke:trip-pass-stripe
bun run qa:trip-pass-launch -- --write
```

Review the redacted manifest. It must show engineering readiness for this SHA and must still show
that human launch authorization depends on this checklist. Confirm these lifecycle cases have exact
evidence:

The migration sequence for the readiness milestone is reserved in
[`trip-pass-migration-coordination.md`](../reference/trip-pass-migration-coordination.md). Do not
change the manifest migration set or add a new Trip Pass migration outside that allocation during
launch.

- return before webhook never activates;
- duplicate and reversed events converge;
- missing prerequisites remain retryable;
- parallel checkout produces one payable Session;
- provider ambiguity reuses the same idempotency key;
- authenticated cancellation releases only after Stripe confirms expiry;
- one complete stored answer consumes one unit;
- failures, safety refusals, and closure release reservations;
- cumulative partial refunds remain Refund Review until fully refunded;
- dispute open/won/lost follows suspension/original-expiry/terminal rules;
- Paid After Closure creates no pass and retries a full refund;
- Redis outage blocks paid use but not verified webhooks;
- reconciliation detects without mutation and repair requires named Operator MFA.

## Rehearse Rollback Before Canary

Prove the deployment-config rollback on the release candidate:

1. Change `TRIP_PASS_CHECKOUT_MODE` from `canary` to `off` through the approved deployment path.
2. Redeploy the exact compatible release.
3. Confirm new Checkout Session creation is denied while existing payments/webhooks still converge.
4. Confirm extension and legacy checkout remain unavailable.
5. Run reconciliation dry-run and inspect only opaque local Finding IDs.
6. Record elapsed rollback time and evidence in the launch issue.

If this rehearsal fails or takes longer than the operations owner accepts, do not run a live canary.

## Run the Allowlisted Live Canary

The canary uses the normal commerce/access path with no bypass. Use an explicitly allowlisted,
named internal Operator Account with no active pass or Effective Pending Order. Use no real customer.

1. Confirm the exact release SHA is deployed and checkout mode is `off`.
2. Add only the approved internal Account ID to the server-only canary allowlist.
3. Set `TRIP_PASS_CHECKOUT_MODE=canary` and deploy through the approved path.
4. Confirm non-allowlisted accounts cannot create Checkout Sessions.
5. Start one live card Checkout from the allowlisted account.
6. Confirm the local Trip Pass Order and 30-minute Session without exposing provider IDs.
7. Return to Ask Siargao and verify the browser shows local processing state until the verified
   Stripe event applies.
8. Confirm exactly one Trip Pass, one Trip Pass Grant, and one 150-answer Usage Meter activate for
   336 hours from database transaction time.
9. Produce one complete, policy-compliant stored answer and confirm exactly one unit finalizes.
10. Confirm Sentry, structured logs, diagnostics, and reconciliation show the expected sanitized
    state and no money/access finding.
11. Have the approved finance Operator issue a full live refund in Stripe.
12. Confirm verified refund application terminally revokes the pass, invalidates reservations, and
    leaves the correct minimized audit evidence.
13. Run reconciliation again and confirm no mismatch.
14. Return checkout mode to `off` unless final full-launch approval immediately follows.

If any step is ambiguous or fails, set mode `off`, preserve records, page the correct owner, and open
an incident/finding. Do not manually edit an Order, Pass, Grant, meter, or event to make evidence
appear successful.

## Make the Final Go/No-Go Decision

After the refunded canary succeeds:

- Reconfirm all five named approvals against the canary evidence.
- Reconfirm the exact SHA/migration identity and no intervening changes.
- Reconfirm Sentry/on-call, scheduler, support, retention, tax, refund, and restore owners.
- Reconfirm canary allowlist and Operator allowlist contents.
- Record a final explicit `go` or `no-go` in the GitHub issue.

Only after `go`, set `TRIP_PASS_CHECKOUT_MODE=on` through the reviewed deployment configuration and
monitor the first production window at the approved cadence. Keep extension and legacy checkout
disabled.

## Roll Back or Respond to an Incident

For any suspected money, access, privacy, authentication, or shared-quota incident:

1. Set `TRIP_PASS_CHECKOUT_MODE=off` and redeploy.
2. Do not disable verified webhook processing or retry workers.
3. Preserve additive schema and immutable commerce evidence.
4. Page on confirmed Stripe persistence/application failure, paid-without-pass, immediate closure
   failure, Redis outage while checkout was open, Paid After Closure refund failure, or live
   reconciliation money/access mismatch.
5. Run read-only reconciliation and diagnostics.
6. Use a Repair Action only with a recorded Finding, named allowlisted Operator, fresh MFA,
   before/after preview, explicit confirmation, and idempotency key.
7. Roll application code back only to a previously verified schema-compatible release.
8. Record timeline, customer impact, actions, and follow-up evidence in the incident and launch issue.

Invalid webhook signatures, abandoned Checkout Sessions, partial refunds, and transient analytics
delivery failures normally create warnings or tickets, not pages, unless evidence shows an attack or
wider incident.

## Completion

The launch is complete only when the GitHub issue records:

- exact deployed SHA and migrations;
- all named approvals;
- protected gate and manifest links;
- external configuration and policy evidence;
- rollback rehearsal timing;
- refunded live canary outcome;
- final `go` decision and full-launch mode change;
- initial monitoring result and any follow-up owner.

Archive evidence according to the approved policy. Never treat the reusable checklist or a prior
launch issue as approval for a later release.
