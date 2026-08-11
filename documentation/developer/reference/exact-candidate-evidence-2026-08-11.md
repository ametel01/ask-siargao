# Exact-Candidate Evidence — 2026-08-11

This record captures release-candidate checks run by Alex Metelli on 2026-08-11 PHT against Git
commit `28e13c980bd01a22976ee4e1c99340a1772f3fb5`. The currently aliased protected staging
deployment is `dpl_8PCPSgNdVBjNJ2NMoNiY2YMFXc9F` at
`https://ask-siargao-3qfsycaul-ametel01s-projects.vercel.app`. Vercel reports it `READY`, in the
`staging` Custom Environment, from repository `ametel01/ask-siargao`, branch `main`, and the exact
candidate SHA. It is assigned to `https://staging.asksiargao.com`.

This candidate is **not Production Ready**. The complete Foundation Gate, capacity, real-provider
canary, health, schedule, rollback, restore, and alert-delivery drills passed. Launch remains
blocked because the protected provider workflow fails closed without a dedicated Google OAuth QA
account. The exact workflow run is
`https://github.com/ametel01/ask-siargao/actions/runs/31465895710`.

## Result summary

| Evidence | Result | Exact-candidate observation |
| --- | --- | --- |
| Foundation Gate | Pass | All ten sequential gates passed, including real PostgreSQL and Redis semantic suites. |
| Clerk/provider release-candidate QA | Fail closed | Protected run `31465895710` denied the Clerk lane with `clerk_google_oauth_credentials_required`; Stripe was dependency-skipped. |
| Twice-beta-limit exercise | Pass | 200 account attempts stopped at 100; 2,000 Travel Answer attempts stopped at 1,000. |
| 25 concurrent chat streams | Pass | All 25 returned final HTTP 200 results with real-provider evidence and no failures. |
| Non-model routes at 20 requests/second | Pass | 100 requests across live and ready returned HTTP 200. |
| 25-answer real-provider canary | Pass | The 25-stream run produced 25 non-empty real-provider answers and 105 upstream request receipts. |
| PostgreSQL headroom | Pass | Stabilized at 10 of 25 connections, 40 percent; one active connection and no deadlocks. |
| Redis headroom | Partial | The unchanged service has prior direct TLS, memory, and persistence proof; this candidate exercised shared Redis through the capacity and chat lanes without shared-state failures, but a fresh direct `INFO` read was unavailable because the sensitive staging URL is non-exportable and 1Password CLI authentication did not complete. |
| Cost circuits and traffic caps | Pass | Fourteen focused tests passed for the USD 10 model circuit, USD 15 Places circuit, emergency stop, 1,000-answer cap, and 100-account cap. |
| Health and Cron adapters | Pass | Live, ready, weather, marine, Places pruning, and operations returned HTTP 200. |
| Application rollback | Pass | The alias moved to the prior deployment, passed health, returned to this commit, and passed health again. |
| Isolated database restore | Pass | A fresh backup restored to a non-production Singapore branch; all selected counts matched. |
| Sentry delivery, acknowledgement, uptime, and Cron | Pass | Exact event delivered and acknowledged; a fresh Cron check-in succeeded; the one-minute uptime monitor produced continuing HTTP 200 readiness probes. |

Passing technical evidence is not Launch Authorization. Alex Metelli remains Operator, Evidence
Owner, Launch Approver, rollback owner, security/privacy owner, and cost owner under the recorded
USD 200 recurring-commitment limit, USD 300 total ceiling, and USD 25 daily provider ceiling.

## Foundation Gate

The canonical commands were:

```sh
bun install --frozen-lockfile
bun run verify:foundation
```

The frozen install changed no package. The complete sequential gate passed:

- Biome checked 521 files;
- a clean TypeScript check passed;
- Bun ran 1,552 tests across 153 files with no failures;
- PGlite migration validation recorded 24 migrations and 73 tables;
- seed validation created five areas, three routes, and six source profiles;
- the production Next.js build passed;
- all 110 functional Playwright tests passed;
- the production-performance Playwright gate passed;
- the real PostgreSQL semantic suite applied the complete migration sequence through `0022`; and
- the real Redis semantic suite passed.

The candidate repair also passed 240 focused chat, security, and provider tests. It preserves
strict fail-close behavior after one bounded repair of invalid model evidence references and keeps
the customer chat concurrency and global traffic controls enforced.

## Protected provider release-candidate boundary

The workflow was manually dispatched from trusted `main` with the exact 40-character candidate
SHA. It checked out that SHA, proved it is contained in remote `main`, installed frozen
dependencies, and reached the protected Clerk preflight. The preflight denied access with:

```text
Protected provider lane denied: clerk_google_oauth_credentials_required
```

The two absent protected secrets are `PROVIDER_RC_CLERK_GOOGLE_EMAIL` and
`PROVIDER_RC_CLERK_GOOGLE_PASSWORD`. The workflow did not contact Google or perform destructive
provider scenarios after denial. The dependent Stripe test-mode job was correctly skipped.
Email-code sign-in, Google OAuth, webhook, ownership, deletion, and Stripe lifecycle receipts must
come from this workflow; manual browser checks do not replace them.

Separate staging authentication and chat smoke evidence passed on the exact code candidate: Clerk
loaded, an authenticated identity probe returned the candidate SHA, and `/api/chat` returned a
successful NDJSON final result with progress and upstream evidence.

## Capacity and control evidence

### Twice the beta limits

The exact candidate's exposure controller ran against disposable Redis 8.2.1 with production mode
and continuous exposure enabled:

| Control | Attempts | Allowed | Limited |
| --- | ---: | ---: | ---: |
| New accounts | 200 | 100 | 100 |
| Travel Answers | 2,000 | 1,000 | 1,000 |

### Twenty-five concurrent streams and provider answers

Twenty-five distinct approved Clerk test identities started chat streams concurrently. All 25
completed with HTTP 200 and non-empty real-provider answers:

| Metric | Observation |
| --- | ---: |
| Failures | 0 |
| Real-provider answers | 25 |
| Progress events | 180 |
| Upstream request receipts | 105 |
| Wall time | 22,066 ms |
| p50 | 18,586 ms |
| p95 | 21,696 ms |
| Maximum | 22,065 ms |

This single run satisfies both the 25-stream capacity check and the distinct 25-answer
real-provider canary.

### Non-model routes

The exact deployment received 100 protected requests across `/api/health/live` and
`/api/health/ready`, scheduled as 20 starts per second for five seconds. All returned HTTP 200.

| Percentile | Seconds |
| --- | ---: |
| p50 | 0.282 |
| p95 | 0.579 |
| p99 | 0.660 |
| Maximum | 1.267 |

The observed local wall time, including CLI and protection-bypass overhead, was 13.257 seconds.

### Cost and traffic controls

Fourteen focused tests passed for the USD 10 model circuit, USD 15 Google Places circuit,
emergency exposure stop, 1,000-answer daily cap, and 100-account daily cap. The 1,001st answer and
101st account were denied.

## Data-service headroom

PlanetScale staging `main` is PostgreSQL 17 in AWS Singapore. Immediately after the 25-stream
burst, warm serverless functions temporarily occupied 24 of 25 connections. After their bounded
idle lifetime expired, the stabilized read-only snapshot showed:

| Metric | Observation |
| --- | ---: |
| Maximum connections | 25 |
| Observed connections | 10 (40%) |
| Active connections | 1 |
| Idle connections | 3 |
| Runtime-role connections | 0 |
| Longest transaction | 0.002 seconds |
| Deadlocks | 0 |
| Temporary bytes | 0 |
| Database size | 13,899,443 bytes |
| Applied migrations | 24 |

Redis Cloud staging is the unchanged 250 MB Singapore service. Its most recent direct restricted
credential snapshot proved `rediss://`, `PONG`, about 2.65 MB used, AOF enabled, last AOF write
`ok`, and no pending background fsync. The exact candidate then passed both the Redis semantic
lane and the shared-state capacity/chat exercises with no Redis-unavailable or fail-closed result.
A fresh direct `INFO` snapshot could not be taken because Vercel correctly returns no value for
the sensitive staging variable and the local 1Password CLI session could not complete biometric
authentication. The service value was not exposed or downgraded to plaintext.

## Health and schedules

The current exact deployment returned `READY`; `/api/health/live` and `/api/health/ready` returned
HTTP 200. After rotating only the non-exportable staging Cron credential and redeploying the same
Git commit, authenticated schedule checks returned:

| Route | HTTP | Duration | Result |
| --- | ---: | ---: | --- |
| `/api/cron/weather` | 200 | 1.690 s | Four facts and four evidence rows processed. |
| `/api/cron/marine` | 200 | 1.273 s | Five facts and five evidence rows processed. |
| `/api/cron/places-prune` | 200 | 0.379 s | No expired rows; bounded non-dry-run completed. |
| `/api/cron/operations` | 200 | 0.444 s | No pending alerts; weather, marine, and pruning healthy. |

The operations response also confirmed no queued account-closure, commerce-reconciliation,
refund, pending-Stripe-event, or retention-purge work.

## Rollback and restore

The staging alias moved from the exact code candidate to prior deployment
`dpl_7GVTPs1i3HVpsLWBoEgqnRufm2Jz` at commit
`5aef6ee18741340c01d8ad57512ba933859bffd9`. Liveness and readiness returned HTTP 200. The alias
then returned to commit `28e13c9`, where both probes again returned HTTP 200. The rollback probe
took 11.464 seconds and the complete move-and-restore took 23.556 seconds.

PlanetScale backup `9n74p8xd5asu`, named `exact-candidate-28e13c9-20260811`, completed at
2026-08-11 06:12:12 UTC with size 9,363,011 bytes. It restored to non-production PS-DEV branch
`exact-candidate-restore-28e13c9`, branch ID `mi4g2qg9lw11`, in Singapore. The branch became ready
at 06:22:12 UTC. Source and restored branch matched on:

| Check | Source `main` | Restored branch |
| --- | ---: | ---: |
| Public tables | 74 | 74 |
| Applied migrations | 24 | 24 |
| Areas | 5 | 5 |
| Source profiles | 6 | 6 |
| Facts | 9 | 9 |
| Public pages | 0 | 0 |
| Users | 33 | 33 |
| Chat threads | 60 | 60 |
| Schedule-state rows | 3 | 3 |

The backup-to-ready cycle was about 11 minutes 10 seconds, within RPO 15 minutes and RTO four
hours. Validation credentials were revoked. Both isolated evidence branches and the temporary
capacity database role were deleted after validation; the retained PlanetScale backups remain the
recovery source.

## Alert and monitor evidence

Sentry accepted exact-candidate event `118aabd4-ae5b-46e1-948a-cf4e0771b28b` for release
`28e13c9`, environment `staging`, and the exact deployment tag. It created issue
`ASK-SIARGAO-4`. The Operator added the acknowledgement comment and resolved the issue.

The Account Closure Cron monitor received a fresh successful staging check-in. The free external
uptime monitor `Ask Siargao Staging — Readiness` is enabled at one-minute intervals with a
five-second timeout, three-failure detection, and one-success resolution. Its dedicated Vercel
automation-bypass header was refreshed and its test succeeded. Vercel recorded eight consecutive
HTTP 200 readiness requests on the current deployment during the observation window. The monitor
is connected to the email action `Ask Siargao — Operational Paging`.

## Cleanup and remaining actions

The temporary PlanetScale capacity role, both isolated restore branches, the temporary Clerk user
file, the temporary PlanetScale credential file, and the one-time Cron credential handoff file were
deleted. Branch deletion is not directly reversible; the retained backups can create new isolated
restore branches.

Only these release actions remain:

1. Create a dedicated challenge-free Google test account, store its email and password as the two
   protected GitHub environment secrets, and rerun protected workflow `provider-release-candidate`
   with SHA `28e13c980bd01a22976ee4e1c99340a1772f3fb5`.
2. Complete a fresh direct Redis `INFO` headroom snapshot after 1Password CLI biometric access is
   restored. The application and semantic Redis checks are green, but the direct metric remains
   partial rather than being silently transferred from the earlier infrastructure snapshot.
3. Update the restricted 1Password staging item with the rotated `CRON_SECRET` after CLI biometric
   access is restored. Vercel Cron is already using the new credential successfully.
4. If the protected Clerk and Stripe jobs pass and the Redis/secret-management evidence closes,
   record Alex Metelli's Launch Authorization before sending production traffic.
