# Trip Pass Implementation Progress

This ledger tracks execution of `PLAN.md` from repository revision `f4e850a`.
Preserve prior entries, append validation evidence, and keep each step aligned with its focused
commit.

## Baseline

- Plan baseline revision: `1deb02c`.
- Execution start revision: `f4e850a`.
- Pre-Step-0 gate repairs:
  - `890fcca` kept public discovery routes available with fixture fallback when the optional
    database-backed catalog is unreachable or empty.
  - `ba11ed3` restored automatic one-request browser-location capture for near-me prompts.
  - `7e290e2` scoped public API rate limits by route path.
- Started: `2026-07-14T00:18:18Z`.
- Initial worktree state: clean, `main...upstream/main [ahead 1]`.
- Feature flags remain default-disabled until release criteria pass:
  `TRIP_PASS_CHECKOUT_ENABLED`, `TRIP_PASS_EXTENSION_ENABLED`, and
  `DEEPSEEK_COST_POLICY_ENABLED`.
- Release approvals still required before production enablement: production Stripe Price,
  refund/dispute policy, Redis provider and retention policy, paid fallback budget, analytics host
  and retention, legal copy, WAF challenge mode, and final release runbook approval.
- Baseline gate outcome: passed after the pre-Step-0 gate repairs above.

## Step 0 - Progress and Changelog Tracking Setup

- Status: `DONE`
- Started: `2026-07-14T00:18:18Z`
- Completed: `2026-07-14T00:34:51Z`
- Implementing commit SHA: this Step 0 commit.
- Files and behavior changed: created `PROGRESS.md`; no production behavior changes.
- Acceptance criteria checked: all remaining steps are listed as `TODO`; existing changelog content
  was preserved except for the separate functional gate-repair commits; no production or feature
  behavior changed in this tracking step.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes applied.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 345 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 996 tests, 0 failures, 5359 assertions.
  - `bun run db:migrate:test`: passed, 50 tables and 8 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: no changelog entry planned; tracking-only change.
- Risks, follow-ups, or blocker: none.

## Step 1 - Freeze the Versioned Product and Feature-Flag Contract

- Status: `DONE`
- Started: `2026-07-14T00:35:00Z`
- Completed: `2026-07-14T00:45:11Z`
- Implementing commit SHA: this Step 1 commit.
- Files and behavior changed: added `src/server/trip-pass/catalog.ts` and catalog tests for the
  versioned 14-day Trip Pass product, 10/3/1 free limits, 150/40/8/20/25 paid limits, warning
  thresholds, free/paid rate caps, cost budgets, disabled checkout and extension rollout states,
  DeepSeek cost-policy state, anonymous identity, Redis, analytics, fallback, WAF, and provider
  budget environment parsing; moved the existing payment meter defaults to the shared catalog;
  replaced the disconnected site price constant with Stripe-authority presentation data; documented
  the new environment variables in `.env.example` and the developer environment reference.
- Acceptance criteria checked: one authoritative catalog now owns the duration, free limits, paid
  limits, thresholds, rate caps, and cost budgets; checkout and extension default to disabled and
  typed unavailable when enabled without launch configuration; tests cover missing, malformed,
  disabled, enabled, and public-prefixed server-only configuration states; no Stripe amount is
  hard-coded as entitlement authority.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes applied.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 347 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 1002 tests, 0 failures, 5385 assertions.
  - `bun run db:migrate:test`: passed, 50 tables and 8 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added an `Added` entry under `[Unreleased]` for the
  operator-visible Trip Pass product and configuration contract.
- Risks, follow-ups, or blocker: launch approvals remain required before enabling checkout,
  extensions, WAF challenge mode, paid fallback, analytics, and production price use.

## Step 1A - Capture Per-Answer DeepSeek Usage and Cost Baselines

- Status: `DONE`
- Started: `2026-07-14T00:45:30Z`
- Completed: `2026-07-14T00:56:10Z`
- Implementing commit SHA: this Step 1A commit.
- Files and behavior changed: added normalized model-usage and cost accounting in
  `src/server/llm/model-cost.ts`; extended DeepSeek and OpenAI response adaptation to carry
  cache-hit input, cache-miss input, input, output, reasoning, total tokens, model, mode, and
  upstream request ID when provided; wrapped agent model calls in a request-scoped accumulator that
  records sanitized `llm_cost_recorded` telemetry and exposes aggregate `modelCost` on internal turn
  results; added a fixed 10-case Trip Pass cost baseline corpus and runner plus the generated
  redacted artifact at `docs/evaluations/trip-pass-cost-baseline-2026-07-14.json`.
- Acceptance criteria checked: DeepSeek representative full and partial usage fields round-trip
  without invented zeros; OpenAI fallback maps onto the same normalized type; request totals
  aggregate across calls and exclude prompt text, tool output, reasoning content, raw user/IP/cookie,
  email, and precise coordinates; supplied DeepSeek CSV rows reconcile exactly to modeled costs;
  the baseline artifact records 10 stable cases, quality result, tool order, artifact kinds, call
  counts, token classes, thinking-high mode, fallback state, and modeled costs without sensitive
  content.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes applied after final edits.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 352 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 1006 tests, 0 failures, 5405 assertions.
  - `bun run eval:trip-pass-cost-baseline -- --write`: passed; export reconciliation
    `0.111115984` USD modeled vs exported across 76 calls; baseline corpus total `0.0295274` USD
    across 20 modeled calls.
  - `bun run db:migrate:test`: passed, 50 tables and 8 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added an `Added` entry under `[Unreleased]` because
  operators now have redacted model-cost telemetry and a supported Trip Pass cost-baseline runner.
- Risks, follow-ups, or blocker: the baseline runner uses sanitized fixture measurements for the
  fixed corpus; future candidate optimization must use the same ordered case IDs and distinguish
  cold-prefix priming from warm repeated runs.

## Step 1B - Apply Entitlement-Aware DeepSeek Cost Policies

- Status: `DONE`
- Started: `2026-07-14T00:56:20Z`
- Completed: `2026-07-14T01:07:21Z`
- Implementing commit SHA: this Step 1B commit.
- Files and behavior changed: added `src/server/chat/cost-policy.ts` with baseline, free, paid
  routine, and paid heavy policies; made DeepSeek thinking mode explicit through internal request
  policy metadata while preserving baseline request construction when
  `DEEPSEEK_COST_POLICY_ENABLED=false`; bounded free/paid output, tool, turn, normal-call, and
  absolute-call budgets; disabled automatic OpenAI fallback for free candidate traffic and required
  paid fallback to be explicitly enabled with a positive budget; added a typed
  `model_budget_exhausted` API error; extended the fixed corpus runner to write a candidate
  comparison artifact at `docs/evaluations/trip-pass-cost-candidate-2026-07-14.json`.
- Acceptance criteria checked: flag-off behavior remains baseline thinking-high with automatic
  fallback; flag-on free and paid routine requests use `thinking: disabled`; paid heavy requests keep
  thinking-high; free DeepSeek failure does not invoke OpenAI fallback; paid fallback is allowed only
  with `OPENAI_FALLBACK_ENABLED=true` and a positive fallback daily budget; all model calls,
  including repair retries, pass through the absolute model-call budget; fixed candidate corpus
  preserves all 10 passing quality cases and remains at 20 calls with normal fixture paths at or
  under four calls.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes applied after final edits.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 355 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 1014 tests, 0 failures, 5419 assertions.
  - `bun run eval:trip-pass-cost-baseline -- --write`: passed; baseline remains `0.0295274` USD,
    178000 cache-miss input tokens, and 20 modeled calls.
  - `bun run eval:trip-pass-cost-candidate -- --write`: passed; candidate is `0.02077698` USD,
    118319 cache-miss input tokens, and 20 modeled calls; cache-miss input reduced 33.53% and
    modeled cost reduced 29.63%, passing the 20% target.
  - `bun run db:migrate:test`: passed, 50 tables and 8 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added a `Changed` entry under `[Unreleased]` for
  flag-gated entitlement-aware model and fallback behavior.
- Risks, follow-ups, or blocker: entitlement metadata is not yet persisted, so the runtime policy
  seam accepts `tripPassEntitlement` / `tripPassCostPolicyTier` metadata until later steps wire
  server-authoritative entitlements; the candidate comparison is fixture-backed and must be rerun on
  the same case IDs when live provider measurements are promoted.

## Step 2 - Add the Order, Grant, and Usage Event Ledger

- Status: `DONE`
- Started: `2026-07-14T01:10:37Z`
- Completed: `2026-07-14T01:19:07Z`
- Implementing commit SHA: this Step 2 commit.
- Files and behavior changed: added `trip_pass_orders`, `trip_pass_grants`, and
  `trip_usage_events` to the Drizzle schema and additive `0008` migration; included safe product,
  price, amount, currency, provider, metadata, grant, and usage snapshots; added unique checkout,
  provider-event, and usage idempotency keys; added status/type/timestamp/positive quantity checks;
  added hot-path and foreign-key-supporting indexes; included operational rollback guidance as
  flag disablement plus forward repair; updated database authorization table grants for the new
  runtime-owned ledger tables.
- Acceptance criteria checked: fresh and idempotent test migrations apply; the migrated schema and
  typed Drizzle exports remain in parity; PGlite constraints reject duplicate checkout, grant, and
  usage application keys plus negative or invalid amount and quantity records; existing Trip Pass,
  audit, payment, chat, seed, build, and browser flows remain compatible.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes applied after final edits.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 355 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 1015 tests, 0 failures, 5432 assertions.
  - `bun test src/server/db/migration.test.ts`: passed, 19 tests, 0 failures, 130 assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added an `Added` entry under `[Unreleased]` for the
  durable Trip Pass order, grant, and usage-event ledger.
- Risks, follow-ups, or blocker: no blocker; later checkout, webhook, and entitlement steps still
  need to write server-authoritative rows into the new ledger.

## Step 3 - Implement Entitlement Selection and Idempotent Grants

- Status: `DONE`
- Started: `2026-07-14T01:21:33Z`
- Completed: `2026-07-14T01:28:42Z`
- Implementing commit SHA: this Step 3 commit.
- Files and behavior changed: added `src/server/trip-pass/entitlement.ts` as the server-owned
  entitlement core for idempotent Trip Pass grants, transactional pass/grant/meter creation,
  owner-scoped source and order validation, deterministic effective-pass selection, computed expiry,
  and revoked-access projection.
- Acceptance criteria checked: repeated source references return one grant/pass effect; a two-client
  duplicate grant race produces one granted result and one duplicate result; source or order reuse
  for another owner is rejected without creating extra rows; meter grants match the catalog snapshot;
  active selection chooses one owner-scoped pass by latest expiry and deterministic tie-break; expiry
  is computed at the exact boundary without cron-driven status changes; refunded passes project as
  revoked and unrelated owners receive no pass.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes applied after final edits.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 357 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 1022 tests, 0 failures, 5458 assertions.
  - `bun test src/server/trip-pass/entitlement.test.ts`: passed, 7 tests, 0 failures, 26
    assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: extended the existing `[Unreleased]` `Added` ledger entry
  to include server entitlement decisions rather than adding a duplicate internal-domain entry.
- Risks, follow-ups, or blocker: no blocker; later checkout and webhook steps still need to call
  `grantTripPass` from authenticated checkout/webhook flows.

## Step 4 - Create Safe Trip Pass Checkout Orders

- Status: `DONE`
- Started: `2026-07-14T01:29:54Z`
- Completed: `2026-07-14T01:36:54Z`
- Implementing commit SHA: this Step 4 commit.
- Files and behavior changed: added `src/server/trip-pass/stripe-adapter.ts` and
  `src/server/trip-pass/commerce.ts` for Trip Pass-specific Checkout Session construction,
  restricted-key-compatible Stripe calls, local order creation/reuse, stale pending order
  replacement, returned-session metadata and Price validation, checkout-created persistence, and
  safe checkout URL return without exposing Stripe identifiers from the service result.
- Acceptance criteria checked: disabled and unavailable checkout do not create orders or call
  Stripe; local pending orders are created before Stripe calls; duplicate clicks reuse the same
  local order and Stripe idempotency key; stale pending orders are expired before deterministic
  replacement; Stripe failures leave a retryable pending order; another user's pending order is not
  reused or exposed; mismatched Stripe session metadata or Price is rejected; checkout creation
  creates no pass or grant; existing audit checkout and webhook fixture behavior remains unchanged.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes applied after final edits.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 360 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 1029 tests, 0 failures, 5503 assertions.
  - `bun test src/server/trip-pass/commerce.test.ts`: passed, 7 tests, 0 failures, 45
    assertions.
  - `bun test src/server/trip-pass/commerce.test.ts src/server/payments/stripe-lifecycle.test.ts src/app/api/audit/checkout/route.test.ts`:
    passed, 23 tests, 0 failures, 106 assertions; used deterministic test-mode Stripe fixtures and
    audit checkout regressions because live Stripe CLI credentials/configuration are not present in
    this workspace.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added an `Added` entry under `[Unreleased]` for
  authenticated Trip Pass Checkout order creation with webhook-only activation boundaries.
- Risks, follow-ups, or blocker: no blocker; Step 6 still needs to expose the protected API route
  and Step 5 still needs to apply verified Stripe events to these orders.

## Step 5 - Apply Verified Stripe Events to Trip Pass Orders

- Status: `DONE`
- Started: `2026-07-14T01:38:02Z`
- Completed: `2026-07-14T01:48:47Z`
- Implementing commit SHA: this Step 5 commit.
- Files and behavior changed: added `src/server/trip-pass/webhook-application.ts` and fixture
  tests; dispatched Trip Pass events from the verified Stripe webhook route before audit payment
  handling; registered Trip Pass webhook telemetry; applied checkout paid, async failure, expiry,
  refund, and dispute outcomes only after local order/session/product/Price/payment matching.
- Acceptance criteria checked: paid checkout events activate only when matched to the owned local
  order; replayed and concurrent paid deliveries produce one pass, one grant, and one meter
  allocation; refund and dispute events are idempotent and scoped to the matched Trip Pass payment
  intent; unrelated audit product events still flow through the audit webhook path, while unsigned
  requests are rejected before event application.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes on final run.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 362 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed on the final sequential run, 1036 tests, 0 failures, 5538 assertions.
  - `bun test src/server/trip-pass/webhook-application.test.ts src/app/api/stripe/webhook/route.test.ts`:
    passed, 20 tests, 0 failures, 157 assertions.
  - `bun test src/server/trip-pass/webhook-application.test.ts src/app/api/stripe/webhook/route.test.ts src/server/payments/stripe-lifecycle.test.ts src/app/api/audit/checkout/route.test.ts`:
    initial overlapping PGlite run failed because a concurrent `db:migrate:test` process corrupted
    the shared `.tmp/pglite-step3` test database; reran the failing Trip Pass meter lane in
    isolation successfully, then reran full `bun test` sequentially successfully. Deterministic
    Stripe fixture coverage was used for duplicate/reordered, forged, mismatched, refund, dispute,
    and audit cross-product events because live Stripe CLI credentials/configuration are not present
    in this workspace.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added a `Security` entry under `[Unreleased]` for verified
  webhook-only Trip Pass activation and idempotent lifecycle handling.
- Risks, follow-ups, or blocker: no blocker; Step 6 still needs owner-scoped status and checkout
  routes.

## Step 6 - Expose Owner-Scoped Trip Pass Status and Checkout Routes

- Status: `DONE`
- Started: `2026-07-14T01:50:56Z`
- Completed: `2026-07-14T02:01:02Z`
- Implementing commit SHA: this Step 6 commit.
- Files and behavior changed: added `src/server/trip-pass/presentation.ts`,
  `GET /api/me/trip-pass`, and `POST /api/me/trip-pass/checkout`; projected free, pending,
  active, expired, and unavailable Trip Pass states with redacted allowances, warning flags,
  validity timestamps, private no-store headers, same-origin checkout protection, and sanitized
  checkout failure mapping; updated Clerk route-policy inventory for the new protected account APIs.
- Acceptance criteria checked: responses omit Stripe IDs, internal user IDs, local order IDs, raw
  provider errors, grants, and webhook records; warning thresholds cover chat remaining `<= 20`,
  live remaining `<= 5`, and expiry within `<= 48` hours; unauthenticated and cross-user requests
  cannot inspect or buy another user's pass; cross-origin checkout attempts are rejected before the
  checkout service runs.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes on final run.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 368 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test src/server/auth/clerk-route-policy.test.ts src/server/trip-pass/presentation.test.ts src/app/api/me/trip-pass/route.test.ts`:
    passed, 15 tests, 0 failures, 152 assertions.
  - `bun test`: passed, 1045 tests, 0 failures, 5594 assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed; production route inventory includes `/api/me/trip-pass` and
    `/api/me/trip-pass/checkout`.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added an `Added` entry under `[Unreleased]` for
  owner-scoped Trip Pass status and checkout APIs.
- Risks, follow-ups, or blocker: no blocker; Step 7 still needs the shared atomic quota store before
  anonymous identity and paid metering can depend on cross-instance counters.

## Step 7 - Install the Shared Atomic Quota Store

- Status: `DONE`
- Started: `2026-07-14T02:02:25Z`
- Completed: `2026-07-14T02:15:35Z`
- Implementing commit SHA: this Step 7 commit.
- Files and behavior changed: refactored `src/server/security/rate-limit.ts` to an asynchronous
  injected `QuotaStore` contract; migrated all existing audit, chat, public, Trip Pass checkout,
  Stripe webhook, saved-trip, share, report-access, and public-page rate-limit callers to await the
  async result without changing their 429 response contract; added deterministic in-memory quota
  primitives and Redis-backed fixed-window counters, rolling-window reservations, concurrency
  leases, idempotency records, and budget consumption with rollback on exceeded budgets; retained
  process-local memory for tests while failing closed in production unless a shared store is
  injected.
- Acceptance criteria checked: separate limiter instances observe the same injected store; production
  process-memory usage returns `production_store_required` before mutating local counters; shared
  store failures return typed `quota_store_unavailable` results; parallel memory and Redis checks do
  not overspend provider budgets, do not acquire more than the configured concurrency slots, preserve
  duplicate lease/reservation/idempotency behavior, and expire leases/windows at deterministic
  boundaries; migrated public, chat, checkout, Stripe webhook, Trip Pass, and saved-trip callers
  retain their tested rate-limit behavior after becoming async.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes on final run.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 368 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test src/server/security/security.test.ts`: passed, 18 tests, 0 failures, 193 assertions.
  - `bun test src/app/api/audit/intake/route.test.ts src/app/api/audit/checkout/route.test.ts src/app/api/chat/route.test.ts src/app/api/public/public-index-routes.test.ts src/app/api/public/public-family-routes.test.ts src/app/api/stripe/webhook/route.test.ts src/app/api/me/trip-pass/route.test.ts`:
    passed, 111 tests, 0 failures, 843 assertions.
  - `redis-server --port 6380 --save "" --appendonly no --daemonize yes && redis-cli -p 6380 ping`:
    passed, isolated local Redis returned `PONG`; the process was stopped afterward with
    `redis-cli -p 6380 shutdown nosave`.
  - `bun -e ...createRedisQuotaStore...`: passed against local Redis with a throwaway key prefix;
    fixed counters reached 3, duplicate concurrency leases did not consume a slot, releasing a
    lease allowed a new acquisition, the third unique rolling reservation was rejected, duplicate
    idempotency returned the original value, and an exceeded budget rolled back to 70 used units.
  - `bun test`: passed, 1047 tests, 0 failures, 5612 assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added a `Security` entry under `[Unreleased]` because
  production fail-closed shared quota enforcement is operator-visible.
- Risks, follow-ups, or blocker: no blocker; Step 7A still needs to bind anonymous identities and
  product limits to these shared primitives.

## Step 7A - Issue Privacy-Safe Anonymous Identities and Rolling Limits

- Status: `DONE`
- Started: `2026-07-14T02:16:47Z`
- Completed: `2026-07-14T02:29:19Z`
- Implementing commit SHA: this Step 7A commit.
- Files and behavior changed: added `src/server/trip-pass/anonymous-free-allowance.ts` and tests;
  issued signed anonymous trip cookies with key version, expiry, tamper replacement, near-expiry
  rotation, HttpOnly/SameSite/Secure attributes, and local-development fallback behavior; normalized
  trusted ingress IPs into HMAC-only network cohorts with configurable IPv6 prefixing; bound
  anonymous `/api/chat` to free allowance pre-authorization and post-answer settlement while
  authenticated chat bypasses the anonymous limiter; added release support for rolling-window quota
  reservations so failed generations release success units.
- Acceptance criteria checked: clearing only the cookie from one configured cohort triggers
  `challenge_required` after fresh-trip velocity rather than repeatedly granting a full allowance;
  same trip identity stays bound across VPN/network changes and exhausts the seven-day chat
  allowance; hotel/carrier NAT-style cohorts challenge new identities instead of silently consuming
  one traveler quota; minute starts, daily successes, seven-day meter windows, and per-actor
  concurrency are deterministic; parallel final-unit requests allow exactly one success reservation;
  production with an anonymous HMAC key but no Redis fails closed; response bodies, actor state,
  Redis keys, and tests use only versioned HMAC/coarse state and do not include raw IPs, cookies,
  prompts, emails, User-Agent strings, or coordinates.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes on final run.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 370 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test src/server/trip-pass/anonymous-free-allowance.test.ts src/app/api/chat/route.test.ts src/server/security/security.test.ts`:
    passed, 105 tests, 0 failures, 863 assertions.
  - `redis-server --port 6380 --save "" --appendonly no --daemonize yes && redis-cli -p 6380 ping`:
    passed, isolated local Redis returned `PONG`; the process was stopped afterward with
    `redis-cli -p 6380 shutdown nosave`.
  - `bun -e ...beginAnonymousFreeChat/createRedisQuotaStore...`: passed against local Redis with a
    throwaway key prefix; after nine successful uses exactly one of two parallel final requests
    reserved the last free chat unit, and fresh-ID velocity on the same cohort returned
    `allowed,allowed,allowed,challenge_required,challenge_required`.
  - `bun test`: passed, 1055 tests, 0 failures, 5673 assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added `Security` and `Added` entries under `[Unreleased]`
  for privacy-safe anonymous reset resistance and the free rolling allowance.
- Risks, follow-ups, or blocker: no blocker; Step 7B still needs perimeter/account-velocity/global
  cost controls on top of this identity substrate.

## Step 7B - Add Perimeter, Account-Velocity, and Global Cost Controls

- Status: `DONE`
- Started: `2026-07-14T02:30:25Z`
- Completed: `2026-07-14T03:43:36Z`
- Implementing commit SHA: this Step 7B commit.
- Files and behavior changed: added authenticated free-chat allowance checks that bind Clerk users to
  the same HMAC cohort/usage windows as a valid anonymous trip cookie, added same-cohort account
  velocity challenges, added request idempotency binding for actor, canonical body hash, policy
  version, and token hash, added provider/global model cost circuits before budgeted DeepSeek/OpenAI
  calls, extended the shared quota store with reversible budget reservations, added
  `trip_pass_free_allowance_blocked` telemetry, updated Redis/environment documentation, and added a
  Vercel WAF log-mode runbook for chat, checkout, and auth-entry perimeter rules.
- Acceptance criteria checked: anonymous usage does not reset on sign-in with the same valid trip
  cookie; seven same-cohort Clerk accounts trigger `challenge_required`; forwarded IPs are ignored
  outside trusted ingress but honored in Vercel-mode ingress; same idempotency token plus same body
  dedupes before model work while the same token plus different content returns a conflict;
  idempotency records use only HMAC token/actor hashes and SHA-256 body hashes; provider and global
  model budget races allow exactly one reservation at a one-unit budget; partial cost reservations
  release when a later circuit blocks; model budget failures return the existing controlled
  `model_budget_exhausted` route error; WAF deployment remains log-mode documentation with explicit
  promotion, rollback, owner/expiry, and privacy-safe evidence requirements.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes on final run.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 373 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test src/server/trip-pass/anonymous-free-allowance.test.ts src/app/api/chat/route.test.ts src/server/chat/cost-circuits.test.ts src/server/security/security.test.ts`:
    passed, 115 tests, 0 failures, 897 assertions.
  - `redis-server --port 6380 --save "" --appendonly no --daemonize yes`: passed for isolated
    local Redis validation; the process was stopped afterward with `redis-cli -p 6380 shutdown
    nosave`.
  - `REDIS_URL=redis://127.0.0.1:6380 ... bun --eval ...`: passed against local Redis with a
    throwaway key prefix; sign-in after ten anonymous successes returned `sign_in_required`,
    same-cohort account velocity returned
    `allowed,allowed,allowed,allowed,allowed,allowed,challenge_required`, idempotency returned
    `stored,duplicate,conflict`, provider budget returned `allowed,blocked` with
    `provider_budget`, and global budget returned `allowed,blocked` with `global_budget`.
  - `bun test`: passed, 1065 tests, 0 failures, 5707 assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added `Security` and `Added` entries under `[Unreleased]`
  for perimeter/account velocity/idempotency/cost circuits and the Vercel WAF log-mode runbook.
- Risks, follow-ups, or blocker: no blocker; WAF rules are intentionally documented for log-mode
  operator setup and verification rather than applied from application code.

## Step 8 - Add Request-Idempotent Paid Chat Metering

- Status: `DONE`
- Started: `2026-07-14T03:46:51Z`
- Completed: `2026-07-14T04:15:08Z`
- Implementing commit SHA: this Step 8 commit.
- Files and behavior changed: added `src/server/trip-pass/usage.ts` with paid chat usage sessions,
  active-pass resolution, start/concurrency/daily-success quota reservations, reversible reserved
  ledger events, exactly-once settlement, release-on-failure behavior, and safe allowance
  projection; wired `/api/chat` so active paid travelers skip the authenticated free limiter,
  settle one `chat_message` unit after billable agent success, release reservations on pre-billable
  failure, expose `tripPassUsage` remaining allowance on success, return typed
  `usage_limit_reached` before model execution, and record a sanitized delivery-cancelled telemetry
  event when the request signal is already aborted after settlement.
- Acceptance criteria checked: one successful paid chat settles exactly one meter unit and one
  `settled` usage event; calling settlement twice for the same idempotency key returns duplicate
  without another meter increment; same-body idempotency replay stops before model work and does not
  meter again; pre-billable agent failure releases the reserved event and leaves meter usage
  unchanged; parallel final-unit reservations allow one request and block the other without
  overspending; 2-request concurrency and 30-success/day burst controls stop before model execution
  while preserving the 150-use entitlement; expired and other-owner passes are not treated as active
  paid entitlement; exhausted paid chat returns `usage_limit_reached` with safe remaining allowance
  data.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes on final run.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 375 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test src/server/trip-pass/usage.test.ts src/app/api/chat/route.test.ts src/server/trip-pass/anonymous-free-allowance.test.ts src/server/security/security.test.ts`:
    passed, 120 tests, 0 failures, 991 assertions.
  - `bun test`: passed, 1075 tests, 0 failures, 5810 assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added a `Changed` entry under `[Unreleased]` for
  server-authoritative paid successful-chat metering and typed exhaustion behavior.
- Risks, follow-ups, or blocker: no blocker; matching idempotent replay currently returns the
  existing duplicate response instead of replaying a cached assistant body because no response-cache
  table exists in this plan slice.

## Step 9 - Meter Live Decisions at the Agent Tool Boundary

- Status: `DONE`
- Started: `2026-07-14T03:00:00Z`
- Completed: `2026-07-14T03:19:07Z`
- Implementing commit SHA: this Step 9 commit.
- Files and behavior changed: extended paid chat usage sessions with reusable per-request decision
  meter reservations for `live_refresh`, `heavy_recommendation`, `weather_refresh`, and
  `route_lookup`; passed the active paid usage session into the chat agent runtime; wrapped live
  tool execution so applicable meters reserve before provider work, settle only after successful
  live evidence, release on provider errors, release on fresh-cache-only answers, and return typed
  `live_access_required` tool outcomes without exposing quota state to the model as a tool
  argument.
- Acceptance criteria checked: two supporting Places tools reuse one reservation per live/heavy
  category and consume each category at most once; weather decision reservations block before live
  work when exhausted; provider-unavailable tool results release the reserved decision meter; fresh
  cache results do not consume live or heavy allowance; blocked mixed-category attempts release any
  sibling reservation before returning `live_access_required`; tool call IDs and upstream provider
  request IDs are preserved in metered tool outcomes and usage events; existing mixed artifact
  selection, semantic tool ordering, provider failure, and route-boundary source checks remain
  covered by the focused agent and route suites.
- Exact validation commands and results:
  - `bun run format`: passed, no fixes on final run.
  - `git diff --check`: passed.
  - `bun run lint`: passed, 375 files checked.
  - `bun run typecheck --incremental false`: passed.
  - `bun test src/server/trip-pass/usage.test.ts src/server/chat/ask-siargao-agent.test.ts src/app/api/chat/route.test.ts src/server/security/security.test.ts`:
    passed, 209 tests, 0 failures, 1659 assertions.
  - `bun test src/server/payments/trip-pass.test.ts`: passed, 9 tests, 0 failures, 22 assertions
    after clearing an ignored PGlite temp directory created by an earlier concurrent gate attempt.
  - `bun test`: passed on clean rerun, 1082 tests, 0 failures, 5835 assertions.
  - `bun run db:migrate:test`: passed, 53 tables and 9 migrations.
  - `bun run db:seed:test`: passed, 5 areas, 3 routes, and 6 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 92 tests, 0 failures.
- Changelog decision and entry location: added a `Changed` entry under `[Unreleased]` for
  once-per-request-category live/heavy/weather/route metering, failed/cache-only release behavior,
  and typed `live_access_required` fallback outcomes.
- Risks, follow-ups, or blocker: no code blocker; provider/global cost circuits from Step 7B remain
  enforced for expensive model work, while provider-specific tool-cost accounting is limited to
  Trip Pass decision meters because the current provider tool adapters do not expose per-call cost
  budgets.

## Step 10 - Connect the Free Tier to the Chat Runtime

- Status: `TODO`
- Started: pending
- Completed: pending
- Implementing commit SHA: pending
- Files and behavior changed: pending.
- Acceptance criteria checked: pending.
- Exact validation commands and results: pending.
- Changelog decision and entry location: pending.
- Risks, follow-ups, or blocker: pending.

## Step 11 - Build the Settings and Chat Trip Pass Experience

- Status: `TODO`
- Started: pending
- Completed: pending
- Implementing commit SHA: pending
- Files and behavior changed: pending.
- Acceptance criteria checked: pending.
- Exact validation commands and results: pending.
- Changelog decision and entry location: pending.
- Risks, follow-ups, or blocker: pending.

## Step 12 - Ship Differentiated Pricing and Trust Copy

- Status: `TODO`
- Started: pending
- Completed: pending
- Implementing commit SHA: pending
- Files and behavior changed: pending.
- Acceptance criteria checked: pending.
- Exact validation commands and results: pending.
- Changelog decision and entry location: pending.
- Risks, follow-ups, or blocker: pending.

## Step 13 - Send Privacy-Safe Monetisation Analytics

- Status: `TODO`
- Started: pending
- Completed: pending
- Implementing commit SHA: pending
- Files and behavior changed: pending.
- Acceptance criteria checked: pending.
- Exact validation commands and results: pending.
- Changelog decision and entry location: pending.
- Risks, follow-ups, or blocker: pending.

## Step 14 - Add Reconciliation and Support Diagnostics

- Status: `TODO`
- Started: pending
- Completed: pending
- Implementing commit SHA: pending.
- Files and behavior changed: pending.
- Acceptance criteria checked: pending.
- Exact validation commands and results: pending.
- Changelog decision and entry location: pending.
- Risks, follow-ups, or blocker: pending.

## Step 15 - Prove Siargao Decision Quality Under Monetisation Limits

- Status: `TODO`
- Started: pending
- Completed: pending
- Implementing commit SHA: pending
- Files and behavior changed: pending.
- Acceptance criteria checked: pending.
- Exact validation commands and results: pending.
- Changelog decision and entry location: pending.
- Risks, follow-ups, or blocker: pending.

## Step 16 - Complete Launch Operations and End-to-End Release Proof

- Status: `TODO`
- Started: pending
- Completed: pending
- Implementing commit SHA: pending
- Files and behavior changed: pending.
- Acceptance criteria checked: pending.
- Exact validation commands and results: pending.
- Changelog decision and entry location: pending.
- Risks, follow-ups, or blocker: pending.
