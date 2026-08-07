# Trip Pass Reconciliation and Support Diagnostics

Trip Pass reconciliation is implemented in
`src/server/trip-pass/reconciliation.ts`. It compares local orders, grants,
passes, usage meters, usage events, analytics configuration, shared quota-store
configuration, price-catalog state, and model-cost circuit configuration.

## Default Mode

`buildTripPassReconciliationSnapshot()` and `reconcileTripPassState()` default
to dry-run behavior. Dry runs report issues and planned actions without changing
orders, grants, passes, meters, or usage events.

Mutation requires both:

- `mode: "repair"`
- `confirmMutation: true`

Without explicit confirmation, repair mode returns a skipped action.

## Safe Repairs

The service only repairs idempotent local ledger omissions:

- paid Trip Pass orders without any linked grant receive a manual reconciliation
  grant for the original owner.
- active passes missing usage meter rows receive any missing default meter rows.
- stale reserved usage events are released.

Paid Answer Reservations use their own durable database-time lease and are recovered by the paid
chat reservation boundary. The `trip_usage_events` stale-reservation repair above remains for
legacy and secondary-meter events; it is not the commercial `chat_message` reservation ledger.

The service does not transfer ownership, create grants for ownerless paid
orders, merge duplicate grants, change refunded or disputed state, reprice
historic orders, or reconstruct prompts/provider payloads.

## Support Lookup

`lookupTripPassSupportReference()` accepts a local order reference, local pass
reference, or authenticated user context. When a user context is supplied with an
order or pass reference, it acts as an ownership guard. Cross-user references
return `forbidden`; mixed order/pass references owned by different users return
`ambiguous`.

Support summaries include local order/pass references, coarse statuses, and
meter counts. They do not include email addresses, Stripe checkout session IDs,
Stripe payment intent IDs, raw prompts, precise locations, provider payloads, or
webhook bodies.

## Cost Reconciliation Boundaries

Durable usage events are reconciled against settled meter counts and stored
provider request references. Missing and duplicate provider request references
are reported without reconstructing prompts or repricing historic usage.

`paid_answer_usage_event_missing` is emitted when a settled Paid Answer Reservation has no exact
aggregate event matching its deterministic event ID, paid-answer idempotency key, pass, meter,
account, `settled` event type, and `chat_message` meter type. The check starts from the reservation,
so it also detects a missing event, a linkage mismatch, or a finalize conflict that prevented the
event insert. A correctly linked event whose per-request fields were policy-purged remains valid
because its quantity and ledger identity survive. This issue is audit-only in both dry-run and
repair modes: reconciliation does not fabricate a usage event, and the warning remains until the
exact durable event is restored through an audited ledger correction.

Operational concurrency leases and budget reservation state are held in the shared quota store.
The quota store expires stale entries internally but does not expose a read API for operator
diagnostics, so reconciliation reports shared-store and provider/global circuit configuration.
Commercial Paid Answer Reservations are separate PostgreSQL state and retain only aggregate facts
after their configured per-request detail deadline.

## Admin Surface

`/admin/diagnostics` renders a redacted diagnostics snapshot for local release
review. Production access remains gated by `ADMIN_ACCESS_TOKEN` through the
`x-admin-token` header.
