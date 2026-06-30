# 011 - Add Trip Pass Usage Meter Foundation

Status: ready  
Priority: P2  
Effort: large  
Risk: medium  
Depends on: plans 001 and 002 for a fully green final `bun test` run  
Category: direction and product foundation  
Planned at: `2026-06-30` against `ccdd368`

> Executor instructions: follow this plan step by step. Run each verification command before
> handing off. If a STOP condition occurs, stop and report instead of expanding scope.
>
> Drift check, run first:
>
> ```sh
> git diff --stat ccdd368..HEAD -- docs/PRD.md docs/TECH.md docs/DATA_STRATEGY.md src/server/db/schema.ts src/server/db/migration.test.ts src/server/payments src/app/api/stripe/webhook src/app/api/chat src/server/chat drizzle
> ```
>
> If any in-scope file changed since this plan was written, compare the current code to the
> excerpts below before editing.

## Goal

Create the first concrete trip-pass usage-meter foundation for the chat-first product: typed domain
objects, database tables, persistence functions, and tests for initializing and consuming paid-pass
meters. This plan does not build the paywall UI or switch the existing audit Stripe flow over to
trip passes.

## Why This Matters

The product docs have converged on a one-time trip pass with bounded live evidence refreshes, but
the implemented payment code still targets the older trip-risk audit lifecycle. Without a concrete
pass/meter boundary, live provider gating cannot reliably protect cost, and future payment work has
no stable domain model to integrate with.

## Current Evidence

`docs/PRD.md:30` says:

```md
The first paid product should be a one-time trip pass for a typical two-week stay, not a recurring
SaaS subscription.
```

`docs/PRD.md:48-52` requires free preview, paid live refreshes, redirects, fact normalization, and
rate limits on expensive provider calls. `docs/PRD.md:75-81` suggests first limits:

```md
- 100 chat messages.
- 30 live evidence refreshes.
- 10 heavy recommendation searches.
- Daily weather-aware answers included.
- Cached follow-up answers do not consume live refresh budget.
```

`docs/TECH.md:11-23` shows the intended architecture ending in "usage meters and cost logging" and
states that deterministic code decides whether a user's pass has live refresh budget.

`docs/TECH.md:234-256` sketches `trip_usage_meters` with:

```text
trip_id
meter_type
used
limit
reset_at
updated_at
```

and initial meters:

- `chat_message`
- `live_refresh`
- `heavy_recommendation`
- `weather_refresh`
- `route_lookup`

`docs/TECH.md:258-268` says Stripe webhook verification remains the source of truth for pass
activation and usage meters are initialized for the pass duration.

Current schema around `src/server/db/schema.ts:565-651` is audit-specific:

```ts
export const auditRequests = pgTable("audit_requests", { ... });
...
export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  auditRequestId: text("audit_request_id")
    .notNull()
    .references(() => auditRequests.id),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  ...
});
```

`src/server/payments/stripe.ts:27-80` builds a Stripe Checkout Session for
`siargao_trip_risk_audit`, and `src/server/payments/webhook-application.ts:44-89` applies verified
payments by loading and updating an audit lifecycle. This is valuable webhook infrastructure, but it
does not yet activate a chat trip pass or initialize trip usage meters.

## Commands You Will Need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Search | `rg -n "trip_usage_meters|TripPass|usage meter|createCheckoutSessionForAudit|auditRequestId" docs src/server src/app drizzle` | Shows relevant current state |
| Schema tests | `bun test src/server/db/migration.test.ts` | Schema expectations pass after update |
| Payment/domain tests | `bun test src/server/payments` | Payment tests pass |
| Targeted new tests | `bun test src/server/payments/trip-pass.test.ts` | New trip-pass tests pass |
| DB migrate | `bun run db:migrate:test` | Exit 0 |
| DB seed | `bun run db:seed:test` | Exit 0 |
| Lint | `bun run lint` | Exit 0 |
| Typecheck | `bun run typecheck --incremental false` | Exit 0, no errors |
| Full unit baseline | `bun test` | Exit 0 after plans 001 and 002 land |

## Scope

In scope:

- `src/server/db/schema.ts`
- `drizzle/0000_initial_schema.sql` or a new migration, matching the repo's current migration
  convention
- `src/server/db/migration.test.ts`
- A new trip-pass domain/persistence module, preferably under `src/server/payments/` or
  `src/server/trips/`
- New tests next to that module
- Minimal docs updates in `docs/TECH.md` or `docs/DATA_STRATEGY.md` only if implementation names
  differ from current docs

Out of scope:

- Paywall UI.
- Chat route enforcement of every meter.
- Stripe Checkout Session creation for trip passes.
- Replacing the existing audit checkout and webhook flow.
- Billing plans, subscriptions, coupons, refunds, or customer portal.
- Provider cost analytics beyond meter increments.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/011-trip-pass-meters
   ```

2. Define the domain types and defaults before touching database code.

   Create a small module such as `src/server/payments/trip-pass.ts` with:

   - `TripPassMeterType` union:
     `chat_message | live_refresh | heavy_recommendation | weather_refresh | route_lookup`;
   - default limits matching `docs/PRD.md:75-81`:
     `chat_message: 100`, `live_refresh: 30`, `heavy_recommendation: 10`;
   - decide and document the first code behavior for weather and route:
     use explicit numeric limits, not "infinite". A conservative starting point is
     `weather_refresh: 14` and `route_lookup: 20`, unless docs already changed by implementation
     time;
   - `createTripPassMeterRows({ tripId, startsAt, expiresAt })`;
   - `canConsumeMeter({ used, limit, increment })`;
   - `consumeMeter(...)` or a store-facing function shape that atomically increments later.

   Add pure unit tests first.

   Verify:

   ```sh
   bun test src/server/payments/trip-pass.test.ts
   ```

   Expected: pure tests pass.

3. Add schema for trip passes and meters.

   Add tables with clear names, for example:

   - `trip_passes`
     - `id` text primary key
     - `user_id` nullable FK to `users.id`
     - `email` nullable text
     - `status` text not null (`active`, `expired`, `refunded`, `cancelled` in domain constants)
     - `stripe_checkout_session_id` nullable unique text
     - `stripe_payment_intent_id` nullable text
     - `stripe_event_id` nullable unique text
     - `starts_at` timestamptz not null
     - `expires_at` timestamptz not null
     - `created_at` timestamptz not null default now
     - `updated_at` timestamptz not null default now
   - `trip_usage_meters`
     - `id` text primary key
     - `trip_pass_id` text not null FK to `trip_passes.id`
     - `meter_type` text not null
     - `used` integer not null default 0
     - `limit` integer not null
     - `reset_at` timestamptz nullable
     - `updated_at` timestamptz not null default now

   Add a uniqueness constraint or unique index on `(trip_pass_id, meter_type)`. Follow the existing
   Drizzle schema style in `src/server/db/schema.ts`.

   Migration convention note: this repo currently has `drizzle/0000_initial_schema.sql`. If the
   repo has not introduced incremental migrations by implementation time, update the initial schema
   and migration tests consistently. If incremental migrations have appeared, add the next numbered
   migration instead.

   Verify:

   ```sh
   bun run typecheck --incremental false
   bun test src/server/db/migration.test.ts
   ```

   Expected: typecheck passes; migration test includes the new tables and constraints.

4. Add a persistence store.

   In the same module or a nearby `trip-pass-store.ts`, implement functions such as:

   - `createActiveTripPassWithMeters(input, db)`:
     creates one active pass and all default meters;
   - `getTripPassUsage(tripPassId, db)`:
     returns current meter rows sorted by meter type;
   - `tryConsumeTripPassMeter({ tripPassId, meterType, increment }, db)`:
     atomically increments only if `used + increment <= limit`, and returns either
     `{ status: "consumed", meter }` or `{ status: "limit_exceeded", meter }`.

   Use a transaction or SQL `where used + increment <= limit` update so concurrent requests cannot
   overrun the limit. Do not use a read-then-write sequence without an atomic guard.

   Verify:

   ```sh
   bun test src/server/payments/trip-pass.test.ts
   ```

   Expected: tests cover creation, limit consumption, limit exceeded, and idempotent default meter
   initialization.

5. Add integration tests with PGlite.

   Follow existing database-test patterns from `src/server/db/migration.test.ts` and chat route
   tests that use `runInitialMigration`. Cover:

   - all five default meters are created for a pass;
   - consuming within limit increments `used`;
   - consuming over limit leaves `used` unchanged;
   - duplicate meter initialization for the same pass does not create duplicate meter rows, or the
     store rejects it with a clear error;
   - expired/inactive passes cannot consume meters if the store function checks status.

   Verify:

   ```sh
   bun test src/server/payments/trip-pass.test.ts
   bun run db:migrate:test
   bun run db:seed:test
   ```

   Expected: all pass.

6. Document the integration boundary for the next plan.

   Add a short note to `docs/TECH.md` or `docs/DATA_STRATEGY.md` only if needed to reconcile actual
   table/function names. The note should say:

   - verified Stripe webhook activation will create an active trip pass and initialize meters;
   - chat/provider gates will call `tryConsumeTripPassMeter` before expensive provider work;
   - cached follow-up answers should not consume live refresh budget.

   Do not write broad marketing or paywall copy in this plan.

## Test Plan

- Pure unit tests for meter defaults and `canConsumeMeter`.
- PGlite-backed tests for persistence, atomic consumption, and limit exceeded behavior.
- Migration tests for new tables and uniqueness.
- Existing Stripe audit tests should continue to pass unchanged, proving this plan did not break the
  older audit checkout flow.

## Done Criteria

- Trip-pass and trip-usage-meter tables exist in schema and migrations.
- Domain defaults match the PRD's first paid limits or docs are updated to match the chosen numeric
  limits.
- Store functions can create a pass with meters and atomically consume a meter.
- Tests prove limits are enforced and over-limit attempts do not increment.
- Existing audit payment tests still pass.
- DB migrate/seed test commands pass.
- Lint and typecheck pass.
- `bun test` passes after plans 001 and 002 restore the known baseline.
- `plans/README.md` status row is updated.

## STOP Conditions

Stop and report if:

- Existing migrations have changed and it is unclear whether to edit `0000_initial_schema.sql` or add
  an incremental migration.
- Product docs have changed away from a trip pass into subscriptions or another billing model.
- Implementing atomic meter consumption requires a database abstraction change outside the in-scope
  modules.
- Existing audit payment code cannot coexist with chat trip-pass tables without a larger payment
  domain split.

## Maintenance Notes

This plan intentionally creates the storage and domain boundary before UI/payment routing. Follow-up
work should wire Stripe Checkout metadata to trip-pass activation, then wire chat/provider gates to
meter consumption. Reviewers should scrutinize atomicity of meter consumption and avoid any path
where the LLM decides payment state or live-refresh eligibility.

Suggested commit:

```text
Add trip pass usage meters
```
