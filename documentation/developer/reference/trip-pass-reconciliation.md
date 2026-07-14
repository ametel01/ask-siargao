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

Concurrency leases and budget reservation state are held in the shared quota
store. The quota store expires stale entries internally but does not expose a
read API for operator diagnostics, so reconciliation reports shared-store and
provider/global circuit configuration rather than claiming a durable per-request
lease or budget ledger.

## Admin Surface

`/admin/diagnostics` renders a redacted diagnostics snapshot for local release
review. Production access remains gated by `ADMIN_ACCESS_TOKEN` through the
`x-admin-token` header.
