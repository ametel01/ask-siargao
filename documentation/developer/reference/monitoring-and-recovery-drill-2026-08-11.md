# Monitoring and Recovery Drill — 2026-08-11

This record captures the pre-production monitoring and recovery exercise run by Alex Metelli on
2026-08-11 PHT. It is evidence for the protected staging candidate at Git commit
`d08d5a630d36cf810cf9157b739581e672258e3b`. It does not authorize production traffic.

> Historical policy note: the staffed-window behavior recorded in this drill was current when the
> exercise ran. ADR-0013 subsequently superseded it with Continuous Travel Answer Availability; the
> emergency-stop and rollback evidence remains valid.

## Result

| Control | Result | Evidence |
| --- | --- | --- |
| Sentry event creation | Pass | Event `8a698053600b4987a332efe654858107` created issue `ASK-SIARGAO-1` at 2026-08-10 18:15:00 UTC. |
| Email alert workflow | Pass | Workflow `3828419`, `Ask Siargao — Operational Paging`, recorded `lastTriggered` at 2026-08-10 18:15:25 UTC. |
| Alert acknowledgement | Blocked | The CLI token received HTTP 403 when resolving issue `7664182512`; acknowledgement requires an authenticated Sentry dashboard session or a token with issue-write permission. |
| Mobile alert delivery | Out of zero-cost scope | The approved Developer-plan operating model uses email delivery. Mobile delivery is not a launch requirement while paid Sentry is deferred. |
| Account Closure Cron monitor | Pass | Monitor `ask-siargao-account-closure` is active. Check-in `b2bfb6e6-f09f-4e23-840e-81f8785e904e` completed `ok` in staging at 2026-08-10 18:20:05 UTC. |
| Other Cron schedules | Pass | Migrations `0021_operational_schedule_sentinel.sql` and `0022_operational_schedule_sentinel_authorization.sql` track weather, marine, and Places-pruning success, failure, and staleness without consuming three more Sentry Cron monitors. Deployment `dpl_EM23rMuUKxEcRhbDhRfV97snDS2Z` returned HTTP 200 from the authenticated aggregate route with all schedules healthy or observing. |
| Sentry uptime monitor | Configured | The three unused disabled definitions were removed. The one included monitor targets protected staging readiness with a rotated Vercel automation-bypass header and is enabled; it moves to production readiness at launch. |
| Emergency exposure stop | Pass | Deployment `dpl_3PTfg6K7cDv4LLQJUsviNbNxDCgK` returned HTTP 503 with `emergency_exposure_off` after staging mode changed to `off`. |
| Exposure restoration | Pass | Staging mode was restored to `staffed`; deployment `dpl_FYQjbnMGsqLec4pyjvovaxTurQYH` is ready and returns `outside_staffed_exposure_window` outside 08:00–22:00 PHT. |
| Application rollback | Pass | `staging.asksiargao.com` moved to prior deployment `dpl_4P76cQ3YGxwPg9yPXJWexKBAZxaD`; live and ready probes passed in 14 seconds. The alias then returned to the current candidate. |
| PlanetScale isolated restore | Pass | Backup `t8pwptnhq5he` restored to non-production branch `recovery-drill-20260811`, branch ID `43p8wn3h7ram`, in Singapore. |
| RPO | Pass | The restored point was no more than 218 seconds old when validation began, below the 15-minute objective. Production also has a 12-hour/7-day policy, while continuously archived WAL permits PITR to five minutes before current time within the retention window. |
| RTO | Pass | The recovery branch became ready in 161 observed seconds, below the four-hour objective. |
| Secret rotation | Pass | Both Vercel automation-bypass credentials were revoked and regenerated. A post-rotation protected request succeeded, and the current working-tree validation deployment was rebuilt after the final rotation. |
| Vendor register | Complete with launch blockers | The inventory is in [Production vendor register](production-vendor-register.md). Unresolved contract and retention statuses remain launch blockers. |

## Pre-commit staging validation state

- Canonical URL: `https://staging.asksiargao.com`
- Deployment: `dpl_EM23rMuUKxEcRhbDhRfV97snDS2Z`
- Source: working-tree monitoring validation based on commit `d08d5a630d36cf810cf9157b739581e672258e3b`
- Exposure mode: `staffed`
- Readiness: `{"status":"ready"}`
- Outside-window chat behavior: HTTP 503 with `outside_staffed_exposure_window`

The staging alias was restored after both exposure and rollback exercises. No production domain was
promoted or repointed.

## Sentry monitoring detail

The alert event exercised the real Sentry ingestion endpoint and created a new high-priority issue.
The connected workflow then recorded a trigger and targeted the Ask Siargao team by email. The
current API credential can create and inspect alerts but cannot mutate issue status, so the issue is
still unresolved and cannot count as acknowledged until the Operator resolves it in Sentry.

Sentry uses one scheduled monitor under the approved zero-cost design:

| Schedule | Slug | State |
| --- | --- | --- |
| Every minute | `ask-siargao-account-closure` | Active; aggregate operations sentinel |

The other three Sentry Cron definitions remain disabled as historical placeholders. PostgreSQL
table `operational_schedule_states` now owns their independent state: weather and marine become
stale after three hours plus a 30-minute grace period, while Places pruning becomes stale after one
day plus a 60-minute grace period. Each failed or stale lifecycle creates a deduplicated, scrubbed
Sentry event; recovery closes that lifecycle before a recurrence can page again.

Only the staging readiness uptime detector remains. It uses a dedicated, rotated Vercel
automation-bypass credential in an HTTP header. The three unused detector definitions were deleted
so the enabled detector fits the Developer plan's one-monitor quota. Production liveness and all
staging checks remain required deployment smoke tests. At launch, repoint this same external monitor
to the unprotected production readiness URL.

## Zero-cost monitoring implementation follow-up

On 2026-08-11 PHT, the implementation added the aggregate Sentry Cron check-in, durable schedule
state, lifecycle-deduplicated scheduled-maintenance pages, schema parity, grants inventory, and
regression tests. Migration `0021_operational_schedule_sentinel.sql` was applied to the staging
PlanetScale database. Migration `0022_operational_schedule_sentinel_authorization.sql` was then
applied with the stored staging migration credential. The migration role owns the table, and the
pooled runtime role has only the required `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges.

The first post-grant deployment exposed a separate Sentry HTTP integration defect: the check-in URL
used `/crons/`, while Sentry's documented ingestion contract uses `/cron/`. The implementation and
regression test were corrected. Deployment `dpl_EM23rMuUKxEcRhbDhRfV97snDS2Z` then returned HTTP
200 from protected `/api/health/ready` and the authenticated `/api/cron/operations` route. The
aggregate check-in was accepted by Sentry, and the staging alias was moved to this deployment.

This deployment remains a historical working-tree validation snapshot, not an exact committed
release candidate. The exact-commit deployment that follows this record supersedes it for release
evidence.

Vercel invokes `vercel.json` Cron definitions only on Production deployments. The staging check-in
above is therefore validation evidence, not a claim that protected staging has a native recurring
scheduler. At launch, the production deployment activates the four authenticated Vercel schedules;
until then, staging Cron routes are exercised manually as release smoke checks.

## Emergency exposure exercise

The Operator changed only the Vercel `staging` Custom Environment variable
`TRAVEL_ANSWER_EXPOSURE_MODE` from `staffed` to `off`, redeployed the exact candidate, and assigned
the staging alias to that deployment. A valid anonymous chat request failed before model or provider
work with:

```json
{"error":"travel_answers_unavailable","reason":"emergency_exposure_off"}
```

The Operator restored the variable to `staffed`, redeployed the same commit, and reassigned the
staging alias. Because the test occurred outside the staffed window, the restored response was
`outside_staffed_exposure_window`; this distinguishes normal time gating from the emergency stop.

## Application rollback exercise

The rollback target was the immediately preceding healthy staging deployment:

- deployment: `dpl_4P76cQ3YGxwPg9yPXJWexKBAZxaD`;
- commit: `f569255c4d57cbef0fc8c0f6ef442412803a1619`; and
- known difference: it predates the Redis production-rate-limit bootstrap in the current candidate.

The custom domain alias moved to that deployment, then `/api/health/live` and
`/api/health/ready` both passed. The observed switch and verification took 14 seconds. The alias was
then returned to the current staffed deployment and readiness passed again. Vercel Cron
configuration was not changed; a production rollback must separately verify schedules from
`vercel.json`.

## PlanetScale recovery exercise

The drill created production backup `recovery-drill-20260810T182621Z`:

- backup ID: `t8pwptnhq5he`;
- created: 2026-08-10 18:26:22 UTC;
- completed: 2026-08-10 18:27:08 UTC;
- size: 9,084,589 bytes; and
- expiry: 2026-09-10 18:26:22 UTC.

PlanetScale restored the backup to `recovery-drill-20260811` as an isolated, non-production PS-DEV
branch with no replicas. The branch remained in AWS `ap-southeast-1` Singapore and did not replace
the default branch. Source and restored database validation matched:

| Check | Production `main` | Restored branch |
| --- | ---: | ---: |
| Public tables | 72 | 72 |
| Applied migrations | 21 | 21 |
| `areas` rows | 0 | 0 |
| `source_profiles` rows | 0 | 0 |
| `facts` rows | 0 | 0 |
| `public_pages` rows | 0 | 0 |

The production backup-policy inventory contains custom policy `23yxofwx8zaz`, named
`Ask Siargao 12h 7d`, targeting production every 12 hours with seven-day retention. PlanetScale's
required default production policy also runs every 12 hours with two-day retention. PlanetScale
[continuously archives WAL for PITR](https://planetscale.com/docs/postgres/backups/point-in-time-recovery),
with a five-minute recency buffer, so the configured recovery-point capability is below 15 minutes
throughout the available retention window. This drill restored the new snapshot rather than an
arbitrary PITR timestamp; the next drill should deliberately restore a timestamp between snapshots.

Temporary validation roles expire after one hour. The recovery branch is intentionally retained as
drill evidence and incurs PS-DEV compute until the Operator explicitly deletes it.

## Secret-rotation exercise

Two Vercel Protection Bypass for Automation credentials were present. A metadata inspection exposed
their existing values in local agent output, making rotation mandatory. Both credentials were
revoked with regeneration through the authenticated Vercel API. The result retained two active
automation credentials and exactly one deployment environment selection.

During later Sentry configuration, an HTTP-preview inspection exposed the then-current bypass value
in local browser automation output. Both credentials were immediately revoked and regenerated a
second time. No exposed value remains active, and no secret value is recorded in this document.
Protected health probes using the final credentials succeeded. Deployment
`dpl_EM23rMuUKxEcRhbDhRfV97snDS2Z` was built after the final rotation, refreshing the
platform-provided `VERCEL_AUTOMATION_BYPASS_SECRET`. The next rotation exercise is due no later than
2026-11-09.

## Required actions before production traffic

1. Sign in to Sentry, open `ASK-SIARGAO-1`, confirm the alert arrived at
   `alex-metelli@gmx.com`, then resolve the issue.
2. Make the production health endpoint return 200 on the intended public production deployment,
   then move the one uptime monitor from staging readiness to production readiness.
3. Keep liveness and staging health checks in the deployment smoke gate; do not create more Sentry
   monitors while the Developer plan is the approved operating model.
4. Close the legal and retention blockers identified in the vendor register.
