# Operate The Production Database

Use this runbook to provision, observe, maintain, and restore the production Postgres database for
Ask Siargao.

The production database stores chat history, saved trips, audit/payment/report state, source
records, facts, evidence, public pages, Google Places cache rows, and operational job state. Treat
database operations as production changes: use separated credentials, keep backups enabled, and
validate restoration before depending on a provider backup.

## Prerequisites

- A separate PlanetScale PostgreSQL 17 database in Singapore for each protected environment.
- Provider backups with point-in-time recovery enabled before production traffic starts.
- Separate credentials for migration, runtime, and optional reporting access.
- Server-only deployment secrets. Never expose a database URL with a `NEXT_PUBLIC_` prefix.
- Access to a `psql` session for read-only checks and emergency operator validation.

Use these references alongside this runbook:

- [Environment reference](../reference/environment.md) for `DATABASE_URL`, pool, timeout, SSL, and
  statement-timeout variables.
- [Script reference](../reference/scripts.md) for migration, seed, ingestion, retention cleanup,
  and verification commands.
- [Database authorization reference](../reference/database-authorization.md) for role/grant
  boundaries.
- [Database index audits](../reference/database-index-audits.md) for duplicate and unused-index
  review SQL.

## Provision A Production Database

1. Create separate PlanetScale databases in Singapore for production and Protected Staging. Use the
   smallest highly available production cluster that satisfies launch capacity and the smallest
   single-node staging cluster that can rehearse recovery. Do not use branches of one database as
   the environment boundary.
2. Add a custom backup schedule at least every 12 hours with seven-day retention. PlanetScale's
   default two-day retention does not satisfy the production recovery contract.
3. Confirm point-in-time recovery is available for the retained window before applying migrations.
4. Create or bootstrap the database authorization roles:

```sh
bun -e 'import { buildDatabaseAuthorizationSql } from "./src/server/db/authorization-boundaries"; console.log(buildDatabaseAuthorizationSql())'
```

5. Store separate connection strings in the deployment secret store:

| Credential | Use |
| --- | --- |
| `ask_siargao_migration` login | `bun run db:migrate` and controlled schema repair. |
| `ask_siargao_runtime` login | Deployed app runtime and app-owned jobs using normal DML. |
| `ask_siargao_reporting` login | Optional read-only operational and reporting access. |

6. Configure runtime connection options:

| Variable | Production starting point |
| --- | --- |
| `DATABASE_URL` | Runtime credential through PlanetScale's local PgBouncer on port `6432`; use the direct migration credential on port `5432` only during migration jobs. |
| `DATABASE_POOL_SIZE` | Start at `2` for Vercel functions and tune only from observed concurrency. |
| `DATABASE_CLI_POOL_SIZE` | Keep the default `1` for one-off jobs and migrations. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | Keep the default `10` unless the provider needs more. |
| `DATABASE_IDLE_TIMEOUT_SECONDS` | Keep the default `30` for pooled app connections. |
| `DATABASE_MAX_LIFETIME_SECONDS` | Keep the default `1800` to recycle long-lived sockets. |
| `DATABASE_SSL_MODE` | Use `verify-full`; release-candidate QA must prove PlanetScale hostname and certificate verification. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Start with the production defaults: `30000` for app clients, `120000` for CLI jobs. |

7. Apply migrations with the migration credential:

```sh
bun run db:migrate
```

8. Seed stable taxonomy and source profiles:

```sh
bun run db:seed
```

9. Verify the ledger and seed state:

```sh
psql "$DATABASE_URL" -c "select name, checksum, applied_at from schema_migrations order by applied_at, name;"
psql "$DATABASE_URL" -c "select id, allowed_use, authority_level from source_profiles order by id;"
```

## Observe The Database

Create provider alerts before production launch. The exact dashboard names depend on the managed
Postgres provider, but the alert set must cover these signals.

| Signal | What To Watch | First Response |
| --- | --- | --- |
| Slow queries | p95/p99 query duration and provider slow-query log entries. | Identify the query, confirm whether it is a new path, and compare it with expected indexes. |
| Lock waits | Sessions waiting on relation, transaction, or advisory locks. | Check the blocking PID, migration/job activity, and whether a long transaction is open. |
| Connection pressure | Active connections versus provider max connections. | Lower app pool size, stop nonessential jobs, and check for leaked clients. |
| Cache hit rate | `blks_hit` versus `blks_read` by database/table. | Check memory pressure, recent scans, and missing hot-path indexes. |
| Temp files | Temp file count and bytes. | Look for sort/hash-heavy queries and bounded-list regressions. |
| Deadlocks | Nonzero deadlock count. | Inspect the provider logs and recent write-path or migration changes. |
| Dead tuples | Dead tuple ratio and autovacuum lag by table. | Check whether autovacuum is keeping up and whether batch jobs need smaller batches. |
| Autovacuum | Last autovacuum time and wraparound warnings. | Escalate immediately on wraparound warnings; do not disable autovacuum. |
| Index usage | Low or zero `idx_scan` for large non-unique indexes. | Treat as a review candidate, not a drop instruction. Use the index audit reference. |
| Disk alerts | Data, index, WAL, and backup storage growth. | Stop nonessential ingestion, run retention cleanup if due, and scale storage before full disk. |

Useful read-only checks:

```sql
select
  now() - query_start as age,
  wait_event_type,
  wait_event,
  state,
  left(query, 200) as query
from pg_stat_activity
where state <> 'idle'
order by query_start;
```

```sql
select
  datname,
  round(100 * blks_hit / nullif(blks_hit + blks_read, 0), 2) as cache_hit_percent,
  temp_files,
  temp_bytes,
  deadlocks
from pg_stat_database
where datname = current_database();
```

```sql
select
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_autoanalyze
from pg_stat_user_tables
order by n_dead_tup desc
limit 20;
```

## Maintain The Database

Use a predictable maintenance cadence. Keep routine maintenance bounded so it can run during normal
operations without creating large locks, WAL bursts, or rollback scopes.

| Cadence | Task |
| --- | --- |
| Daily | Review provider health, slow queries, lock waits, connection pressure, disk headroom, and failed jobs. |
| Daily | Run or inspect scheduled Google Places retention cleanup output. |
| Weekly | Review dead tuples, autovacuum lag, cache hit rate, temp files, and table/index growth. |
| Weekly | Run duplicate and unused-index candidate queries from the index audit reference. |
| Monthly | Run a restore drill into a disposable environment and record the result. |
| Before release | Run `bun run verify:foundation` for the Prospective Candidate or rely on the complete trusted-CI Foundation Gate for the exact candidate. |

Run Google Places retention cleanup as a recurring job against production:

```sh
bun run db:prune:google-places -- --dry-run
bun run db:prune:google-places -- --batch-size 500 --max-batches 20
```

The cleanup removes expired Google review, detail, and snapshot rows while preserving durable
`google_places` identities. If the output says expired rows remain, schedule another bounded run
instead of increasing batch size aggressively.

Run duplicate and unused-index reviews from a read-only session. Copy the relevant SQL block from
[Database index audits](../reference/database-index-audits.md) into `psql` and record the result.
Do not drop an index only because it appears unused; confirm the stats reset time, production query
plans, write cost, and current release traffic first.

## Handle Migration Failures

The migration runner uses `schema_migrations` with checksums and a deterministic Postgres advisory
lock. Do not edit historical files in `drizzle/` to fix a failed production migration.

When `bun run db:migrate` fails:

1. Stop the release or job that triggered the migration.
2. Save the migration output, including the failed migration name and checksum/ledger message.
3. Check whether any new migration was recorded:

```sql
select name, checksum, applied_at
from schema_migrations
order by applied_at, name;
```

4. If no new migration was recorded, fix the new migration in the branch and rerun after review.
5. If a partial non-transactional migration ran, stop and restore or repair from an operator-reviewed
   plan. Do not manually mutate the ledger to make the app start.
6. Re-run `bun run db:migrate` with the migration credential after the fix.
7. If the failure involved a new table, verify the runtime role has its intended DML privileges:

```sql
select has_table_privilege(
  'ask_siargao_runtime',
  'public.trip_pass_payment_event_receipts',
  'SELECT,INSERT,UPDATE,DELETE'
);
```

8. Run at least:

```sh
bun run db:migrate:test
bun run db:seed:test
bun run lint
bun run typecheck --incremental false
```

Use the runtime credential only for app traffic. If migration succeeds with the runtime credential,
the production grants are too broad and should be corrected with the authorization reference.

## Back Up And Restore

Set these production targets unless a stricter business target is agreed before launch:

| Target | Requirement |
| --- | --- |
| RPO | 15 minutes or better while point-in-time recovery is available. |
| RTO | 4 hours for full database restore into production after provider access is available. |
| Backup retention | At least 7 days of automated backups and WAL/PITR coverage. |
| Restore drill | Monthly restore into an isolated non-production database. |

PlanetScale point-in-time recovery must be operator-tested before production launch. It restores to
a new branch in the source database's region and supports recovery up to the provider's five-minute
WAL buffer when the target is inside the retained backup window. A backup that has never been
restored is not accepted as production-ready.

Restore drill steps:

1. Pick a timestamp inside the current backup retention window.
2. Restore into a new isolated PlanetScale branch. Never restore over the production branch for a
   drill.
3. Connect with a migration/reporting credential, not the production runtime credential.
4. Validate the restored schema and migration ledger:

```sql
select count(*) as migration_count from schema_migrations;
select name, applied_at from schema_migrations order by applied_at desc limit 5;
```

5. Validate critical table counts:

```sql
select 'source_profiles' as table_name, count(*) from source_profiles
union all select 'facts', count(*) from facts
union all select 'evidence', count(*) from evidence
union all select 'public_pages', count(*) from public_pages
union all select 'google_places', count(*) from google_places
union all select 'chat_threads', count(*) from chat_threads
union all select 'audit_intakes', count(*) from audit_intakes;
```

6. Validate recent operational freshness:

```sql
select result_status, count(*) from refresh_jobs group by result_status order by result_status;
select max(created_at) as newest_fact_created_at from facts;
select max(fetched_at) as newest_source_record_fetched_at from source_records;
```

7. Run app smoke checks against the restored staging environment only after secrets and outbound
   provider settings are safe for staging.
8. Record the restore timestamp, duration, validation queries, row-count anomalies, and whether the
   drill met RPO/RTO.
9. Destroy the disposable restore after validation, following the provider's data handling rules.

## Incident Checklist

Use this checklist for database incidents:

1. Identify whether the impact is read latency, write failure, connection exhaustion, disk pressure,
   migration failure, data corruption, or provider outage.
2. Preserve evidence: provider incident ID, query logs, application logs, migration output, and
   dashboard screenshots.
3. Stop nonessential write jobs first: ingestion, enrichment, Google Places pruning, and public page
   generation.
4. Keep the deployed app runtime on the runtime credential; do not switch it to migration/admin
   credentials to work around grant failures.
5. If data loss or corruption is suspected, stop writes and restore into an isolated environment
   before deciding on repair.
6. After recovery, run the relevant focused tests locally and record the follow-up issue or PR.

## Done Criteria

Production database operations are ready when:

- runtime, migration, and reporting credentials are separated;
- backups and PITR are enabled and a restore drill has passed;
- monitoring covers the required query, lock, connection, cache, temp-file, deadlock, autovacuum,
  index, and disk signals;
- Google Places retention cleanup is scheduled with bounded batches;
- duplicate and unused-index reviews happen on a weekly cadence;
- migration failures have a clear stop, inspect, repair, and validate path;
- the current release candidate has passed the release gate.
