# Exact-Candidate Evidence — 2026-08-11

This record captures release-candidate checks run by Alex Metelli on 2026-08-11 PHT against Git
commit `4b03367c604344fa0514510bdcedc635cb15f7bf`. The protected staging deployment was
`dpl_oWnUDbcYXRVWBrGpw7ossUTxmHnE` at
`https://ask-siargao-65npjrl9m-ametel01s-projects.vercel.app` and was assigned to
`https://staging.asksiargao.com`.

This candidate is **not Production Ready**. The complete Foundation Gate failed in its PostgreSQL
semantic lane, protected provider QA could not run outside its trusted GitHub environment, and the
25-stream and 25-answer exercises lack an approved load-test identity boundary. Passing evidence
below must not be read as Launch Authorization.

## Result summary

| Evidence | Result | Exact-candidate observation |
| --- | --- | --- |
| Foundation Gate | Fail | Eight local gates passed; the PostgreSQL lane failed on a stale expected migration list; the sequential Redis lane did not start. |
| Independent Redis semantic lane | Pass | Repository Redis integration suite passed against disposable Redis 8.2.1. |
| Clerk/provider release-candidate QA | Blocked | The protected workflow requires manual dispatch, trusted `main`, environment approval, and protected credentials. This checkout has no `origin` remote and the local preflight denied both lanes before provider access. |
| Twice-beta-limit exercise | Pass | 200 account reservations produced 100 allowed and 100 limited; 2,000 Travel Answer reservations produced 1,000 allowed and 1,000 limited. |
| 25 concurrent chat streams | Blocked | Staging enforces two concurrent requests per free or paid actor and has no reviewed synthetic load identity or provider stub boundary. |
| Non-model routes at 20 requests/second | Pass | 100 health requests returned HTTP 200; Vercel observed all 100 and a peak of 34 requests in one second. |
| 25-answer real-provider canary | Blocked | One exact-deployment provider answer completed previously; the 25-answer canary was not run after the Foundation failure and cannot safely bypass the 10-answer free allowance. |
| PostgreSQL headroom | Pass | 11 of 25 connections observed, or 44 percent; one active connection, zero deadlocks, zero temporary bytes. |
| Redis headroom | Pass | TLS and `PING` passed; about 2.65 MB used against the recorded 250 MB plan, about 1.1 percent; AOF enabled and last write `ok`. |
| Cost circuits and traffic caps | Pass | Fourteen focused tests passed for the USD 10 model circuit, USD 15 Places circuit, emergency stop, 1,000-answer cap, and 100-account cap. |
| Health and Cron adapters | Pass | Liveness, readiness, weather, marine, Places pruning, and operations returned HTTP 200. |
| Application rollback | Pass | The staging alias moved to the prior deployment, passed live and ready probes, then returned to the exact candidate and passed both probes. |
| Isolated database restore | Pass | A new backup restored to a non-production PS-DEV branch in Singapore; the migration ledger and representative row counts matched. |
| Sentry delivery | Partial | Sentry received exact-candidate event `d7f227ee-0cb4-4292-8e70-8ea6abcb0f6f`; email receipt and issue acknowledgement remain human checks. |

## Foundation Gate

The canonical commands were:

```sh
bun install --frozen-lockfile
bun run verify:foundation
```

The frozen install changed no package. The first eight gates completed:

- Biome checked 521 files;
- clean TypeScript checking passed;
- Bun ran 1,547 tests across 153 files with no failures;
- PGlite migration validation recorded 24 migrations and 73 tables;
- seed validation created five areas, three routes, and six source profiles;
- the production Next.js build passed;
- all 110 functional Playwright tests passed; and
- the production-performance Playwright test passed with zero layout shift and no motion long task
  over 50 ms.

The PostgreSQL semantic lane then failed in
`src/server/integration/postgres-entrypoint.ts`. Its historical-ledger assertion expected the
additive sequence to stop at `0019_operational_page_intent_fencing.sql`, while this candidate
correctly applied `0020_shared_trip_link_expiry.sql`, `0021_operational_schedule_sentinel.sql`, and
`0022_operational_schedule_sentinel_authorization.sql`. Because the aggregate is sequential, its
Redis lane did not start and the complete Foundation Gate did not pass.

The Redis lane was run independently against a uniquely owned disposable Redis 8.2.1 service and
returned the `redis-integration-semantic-suite` receipt for namespace
`exact_candidate_4b03367_redis`.

The deterministic checkout-off manifest is
`.tmp/trip-pass-launch/trip-pass-launch-manifest-4b03367c604344fa0514510bdcedc635cb15f7bf.json`.
Its SHA-256 checksum is `630c45ea1d53be5c137c3df2db5bc7a91d0369b18d53ba474596c9dcb7ef1599`.
As required for a local run, it records `engineeringReady: false`, ten blocked trusted-CI gates,
checkout off, and no human Launch Authorization.

## Provider release-candidate boundary

Local Clerk and Stripe preflight commands both failed closed before contacting either provider.
The missing boundary includes a full expected SHA supplied by manual workflow dispatch, a trusted
repository/default-branch context, protected-environment approval, a protected test database
sentinel, dedicated provider fixtures, and protected origins. The checkout also had no `origin`
remote, so the local preflight could not prove the SHA was contained in remote `main`.

The protected workflow remains the only valid way to produce Clerk and Stripe provider receipts.
Manual browser sign-in or a normal staging chat cannot replace its email-code, Google OAuth,
webhook, ownership, deletion, and Stripe lifecycle scenarios.

## Capacity and control evidence

### Twice the beta limits

The exact candidate's exposure controller ran against disposable Redis 8.2.1 with production mode
and continuous exposure enabled. It attempted twice each configured daily limit:

| Control | Attempts | Allowed | Limited |
| --- | ---: | ---: | ---: |
| New accounts | 200 | 100 | 100 |
| Travel Answers | 2,000 | 1,000 | 1,000 |

This proves atomic stopping at the documented caps. It is control-state evidence, not an end-to-end
Vercel capacity claim.

### Non-model routes

The exact deployment received 100 protected requests across `/api/health/live` and
`/api/health/ready`, scheduled as 20 client starts per second for five seconds. All responses were
HTTP 200. Vercel runtime logs observed all 100 requests and a peak of 34 within one timestamped
second.

HTTP latency, excluding local Vercel CLI authentication overhead, was:

| Percentile | Seconds |
| --- | ---: |
| p50 | 0.301 |
| p95 | 0.473 |
| p99 | 0.576 |
| maximum | 0.883 |

### Chat streams and provider canary

The 25 concurrent stream test was not run. Free and paid actors are both limited to two concurrent
chat requests, and the repository has no approved synthetic load-test actor, provider stub route,
or capacity harness that can exercise 25 streams without weakening those controls.

The 25-answer real-provider canary was also not run. The candidate had already completed one
signed-in DeepSeek answer with HTTP 200, two tool calls, and three upstream requests, but a complete
canary would exceed the per-account free allowance. Creating identities to evade that boundary or
mixing the canary with synthetic load would invalidate the evidence. The canary should run only
after the Foundation and protected-provider blockers are closed.

## Data-service headroom

PlanetScale staging `main` is a ready PS-5 PostgreSQL 17 branch in AWS Singapore with no replicas,
which is permitted for staging. The post-load read-only snapshot showed:

| Metric | Observation |
| --- | ---: |
| Maximum connections | 25 |
| Observed connections | 11 (44%) |
| Active connections | 1 |
| Idle connections | 4 |
| Longest transaction | 0.013 seconds |
| Deadlocks | 0 |
| Temporary bytes | 0 |
| Database size | 12,777,139 bytes |
| Applied migrations | 24 |

Redis Cloud staging uses a recorded 250 MB single-node plan in AWS Singapore. The live restricted
credential proved `rediss://`, `PONG`, ten keys, about 2,652,248 used bytes, AOF enabled, last AOF
write `ok`, and no pending background fsync. The credential cannot execute `CONFIG GET`, so the
live `noeviction` assertion remains represented by the provider configuration record rather than
the runtime command result. Staging has no replica, consistent with its approved single-node plan.

## Health and schedules

The authenticated exact-deployment Cron checks returned:

| Route | HTTP | Duration | Result |
| --- | ---: | ---: | --- |
| `/api/cron/weather` | 200 | 2.115 s | Four facts and four evidence rows processed. |
| `/api/cron/marine` | 200 | 1.538 s | Five facts and five evidence rows processed. |
| `/api/cron/places-prune` | 200 | 0.418 s | No expired rows; bounded non-dry-run completed. |
| `/api/cron/operations` | 200 | 0.582 s | No pending alerts; weather, marine, and pruning healthy. |

Sentry lists `ask-siargao-account-closure` as the one active Cron monitor. The weather, marine, and
Places monitors remain disabled because the quota-efficient PostgreSQL schedule sentinel owns
their independent lifecycle state.

## Rollback and restore

The staging alias moved from the exact candidate to prior deployment
`dpl_2cWSCNekck8miWhzYkD4NQJZL78t`. Liveness and readiness both returned HTTP 200. The alias then
returned to `dpl_oWnUDbcYXRVWBrGpw7ossUTxmHnE`, where both probes again returned HTTP 200. The
complete rollback and restoration took 40.95 seconds.

PlanetScale backup `xfxkjrsyf9p0`, named `exact-candidate-4b03367-20260811`, completed at
2026-08-11 04:02:02 UTC with size 9,132,038 bytes. It restored to non-production PS-DEV branch
`exact-candidate-restore-4b03367`, branch ID `x4w8tzfudp8z`, in Singapore. The branch became ready
132 seconds after creation.

Source and restored branch matched on:

| Check | Source `main` | Restored branch |
| --- | ---: | ---: |
| Public tables | 73 | 73 |
| Applied migrations | 24 | 24 |
| Areas | 5 | 5 |
| Source profiles | 6 | 6 |
| Facts | 9 | 9 |
| Public pages | 0 | 0 |
| Users | 1 | 1 |
| Chat threads | 3 | 3 |
| Schedule-state rows | 3 | 3 |

The observed restore time is below the four-hour RTO objective. The snapshot and validation cycle
was below 15 minutes, while PlanetScale PITR remains the control for recovery points between
snapshots. The restore branch is intentionally retained as evidence and continues to consume
PS-DEV compute until the Operator deletes it.

## Alert evidence

Sentry accepted event `d7f227ee-0cb4-4292-8e70-8ea6abcb0f6f` at
2026-08-11 03:58:59 UTC with release `4b03367c604344fa0514510bdcedc635cb15f7bf` and the exact
deployment tag. A subsequent Sentry event listing returned the same event and title. The available
CLI credential can prove event ingestion but cannot prove delivery to the email inbox or
acknowledge the resulting issue. Those remain human actions and alert evidence is therefore
partial.

## Required next actions

1. Update the PostgreSQL integration expectation to include migrations `0020` through `0022`, add
   regression coverage, create a new commit, and deploy that exact new candidate.
2. Run the complete Foundation Gate again; do not transfer this candidate's failed result.
3. Configure a Git remote, place the new SHA in trusted `main`, and dispatch the protected Clerk and
   Stripe workflow with environment approval.
4. Add a reviewed staging-only capacity boundary that permits 25 synthetic concurrent streams
   without relaxing customer concurrency or invoking real providers.
5. Run the distinct 25-answer real-provider canary after the deterministic capacity gate passes.
6. Confirm the Sentry email arrived and acknowledge or resolve its issue in the dashboard.
7. Delete the isolated restore branch after its evidence-retention window to stop PS-DEV compute.
