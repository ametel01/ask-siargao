# Script Reference

Scripts are defined in `package.json`.

| Script | Command | Purpose |
| --- | --- | --- |
| `bun run dev` | `next dev` | Run the local Next.js dev server. |
| `bun run dev:up` | `docker compose up -d db && db:migrate && db:seed && next dev` | Start local Postgres in Docker, migrate/seed it, then run the host Next.js dev server. This is the preferred local chatbot workflow. |
| `bun run dev:container` | `next dev -H 0.0.0.0` | Run the Next.js dev server inside the Compose app container. |
| `bun run stack:up` | `docker compose up -d db` | Start only the local Postgres service. Use this before host `bun run dev` when database-backed chat behavior is needed. |
| `bun run stack:app:up` | `docker compose --profile app up -d` | Start the opt-in full Compose app container as well as Postgres. Do not run this at the same time as host `bun run dev` on port `3000`. |
| `bun run stack:down` | `docker compose down` | Stop and remove the local Compose app and database containers while keeping volumes. |
| `bun run stack:down:volumes` | `docker compose down --volumes` | Stop the local Compose stack and remove its named volumes for a clean reset. |
| `bun run stack:logs` | `docker compose logs -f` | Follow logs from the local Compose app and database services. |
| `bun run stack:ps` | `docker compose ps` | Show local Compose service status. |
| `bun run build` | `rm -rf .next && NEXT_PRIVATE_BUILD_WORKER=0 ./node_modules/.bin/next build` | Build the production Next.js app from a clean Next output directory. |
| `bun run db:migrate` | `bun run src/server/db/migrate.ts` | Apply unapplied SQL migrations to the Postgres database at `DATABASE_URL` through the `schema_migrations` ledger. Production operators should run this with a migration-only credential mapped to `ask_siargao_migration`, not the deployed runtime credential. |
| `bun run db:seed` | `bun run src/server/db/seed.ts` | Seed Siargao taxonomy and source profiles into the Postgres database at `DATABASE_URL`. |
| `bun run db:discover:google-places` | `bun run src/server/providers/discover-google-places.ts` | Run the free Google Places Text Search ID-only discovery pass for Siargao accommodations and persist dedupable place candidates into `source_records` and `candidate_entities`. Requires `GOOGLE_API_KEY`, `DATABASE_URL`, and a seeded `source_google_places` profile. Add `-- --dry-run` to fetch and print a summary without writing rows. |
| `bun run db:enrich:google-places` | `bun run src/server/providers/enrich-google-places.ts` | Enrich discovered Google Places candidates with Place Details Pro fields: display name, address, location, types, business status, and Google Maps URI. Requires `GOOGLE_API_KEY`, `DATABASE_URL`, and prior `db:discover:google-places` rows. Add `-- --dry-run` to fetch and print a sample without writing rows. |
| `bun run db:prune:google-places` | `bun run src/server/jobs/prune-google-places.ts` | Delete expired Google Places review, detail, and snapshot rows from Postgres at `DATABASE_URL` while preserving durable `google_places` identity rows. Add `-- --dry-run` to count rows without deleting, `-- --batch-size <rows>` to tune each delete batch, and `-- --max-batches <count>` to cap work per table for one run. |
| `bun run db:ingest:open-meteo` | `bun run src/server/providers/ingest-open-meteo.ts` | Fetch the Siargao Open-Meteo forecast and persist source records, weather facts, evidence, scores, and a refresh job into Postgres at `DATABASE_URL`. |
| `bun run db:ingest:open-meteo-marine` | `bun run src/server/providers/ingest-open-meteo-marine.ts` | Fetch the Siargao Open-Meteo Marine forecast and persist modelled sea-level, wave, swell, and current facts into Postgres at `DATABASE_URL`. This is tide-proxy model data, not official tide-gauge or safety authority data. |
| `bun run agent-memory:sync` | `bun run src/server/chat/sync-agent-memory-vector-store.ts` | Sync reference-role `docs/agent-memory/` files to an OpenAI vector store for chat-agent file search. Use `bun run agent-memory:sync -- --dry-run` for local/CI verification without network access. Non-dry-run sync requires `OPENAI_API_KEY`; pass `-- --vector-store-id <id>` or set `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` to reuse an existing store. The command prints the vector store ID to configure and never prints raw memory file bodies. |
| `bun run eval:reality-check` | `bun run src/server/evaluations/run-reality-check-matrix.ts` | Print the deterministic on-demand Reality Check scenario and fail-closed contract matrix. Add `-- --write` to refresh the checked-in JSON artifact. |
| `bun run qa:trip-pass-launch` | `bun run src/server/qa/run-trip-pass-launch-proof.ts` | Emit deterministic, redacted Foundation Gate evidence for the exact checked-out SHA and ordered migration checksums. Add `-- --write` to write the SHA-qualified JSON artifact under `.tmp/trip-pass-launch/`. The manifest records checkout `off` and keeps Foundation Gate Status separate from pending Launch Authorization; it never writes `docs/evaluations/**` or authorizes checkout. |
| `bun run db:migrate:test` | `bun run src/server/db/migrate-test.ts` | Apply unapplied SQL migrations to a PGlite test database through the same ledger runner. |
| `bun run db:seed:test` | `bun run src/server/db/seed-test.ts` | Seed Siargao taxonomy and source profiles into a PGlite test database. |
| `bun run privacy:closure-worker` | `bun run src/server/privacy/run-account-closure-worker.ts` | Process a bounded batch of due Account Closure steps with database leases. Requires production database, Clerk, Stripe, closure-key, and policy configuration; logs only a redacted attempt count. |
| `bun run payments:closure-refund-worker` | `bun run src/server/trip-pass/run-paid-after-closure-refund-worker.ts` | Process a bounded lease-fenced batch of Paid After Closure full-refund obligations. Requires the production database and a restricted Stripe key able to create and retrieve refunds; retries remain durable and page-worthy until Stripe confirms success. |
| `bun run operations:reconcile` | `bun run src/server/operations/run-commerce-reconciliation.ts` | Read current Stripe facts before opening a finding-only database transaction. Add `-- --order=<opaque-local-order-id>` to scope the run; no mutation flag exists. |
| `bun run operations:worker` | `bun run src/server/operations/run-operational-worker.ts` | Process durable provider-neutral Account Closure, Pending Stripe Event, Paid After Closure refund, retention purge, and reconciliation tasks through production handlers. Use `-- --task=<kind-or-all>`, `--batch=<positive-count>`, and `--lease-seconds=<positive-count>`; task claims, retries, crash recovery, and completion are database-time lease fenced. This command does not choose a scheduler vendor or cadence. |
| `bun run privacy:restore-guard` | `bun run src/server/privacy/run-restore-guard.ts` | Fail closed before restored traffic is enabled unless the recorded privacy reapplication snapshot matches `PRIVACY_RESTORE_SNAPSHOT_VERSION`, covers `PRIVACY_RESTORE_SOURCE_MAX_CLOSED_AT`, and was applied after that closure watermark. |
| `bun run test:integration:postgres` | `bun run src/server/integration/postgres-entrypoint.ts` | Run the repository-native PostgreSQL integration lane against a real disposable test service. Requires `DATABASE_URL`, creates a unique database for the run, applies the full migration ledger, proves rollback, database-time, uniqueness, transaction recovery, and advisory-lock semantics across independent connections, then drops only that database. It fails instead of falling back to PGlite when the service is absent or production-looking. |
| `bun run test:integration:redis` | `bun run src/server/integration/redis-entrypoint.ts` | Run the repository-native Redis integration lane against a real disposable test service. Requires `REDIS_URL`, uses a unique per-run key prefix, proves shared atomic windows, budget consume/release, idempotency, concurrency leases, rolling reservations, expiry recovery, paid-path fail-closed behavior, and verified Stripe webhook Redis independence, then deletes only that prefix. It fails instead of falling back to process-local behavior when the service is absent or production-looking. |
| `bun run format` | `biome format --write .` | Write Biome formatting fixes. |
| `bun run lint` | `biome check .` | Run the non-mutating Biome check used by CI. |
| `bun run typecheck` | `tsc --noEmit` | Run TypeScript type checking. |
| `bun run verify` | `bun run lint && bun run typecheck --incremental false && bun test` | Run the fast non-mutating local verification gate. |
| `bun run verify:foundation:local` | `bun run src/server/qa/run-foundation-local.ts` | Run the eight local Foundation Gates sequentially: lint, clean typecheck, Bun tests, PGlite migration and seed validation, production build, functional Playwright, and production-performance Playwright. It stops on the first failure and does not run the real PostgreSQL or Redis lanes. |
| `bun run verify:foundation` | `bun run src/server/qa/run-foundation.ts` | Run the complete ten-gate Foundation Gate. It preflights both real-service boundaries, accepts only safe disposable `DATABASE_URL` and `REDIS_URL` targets when supplied, otherwise provisions uniquely owned pinned Docker services on dynamic loopback ports, then runs `verify:foundation:local`, PostgreSQL, and Redis sequentially. |
| `bun test` | `bun test` | Run Bun unit and integration tests. |
| `bun run test:e2e` | `playwright test` | Run functional Playwright browser tests, excluding the production-performance tag. |
| `bun run test:e2e:production-perf` | `PLAYWRIGHT_PRODUCTION_PERF=1 playwright test` | Run the tagged production-performance Playwright lane against a built `next start` server. |
| `bun run test:e2e:clerk` | `playwright test --config=playwright.clerk.config.ts --grep-invert='final live boundary'` | Run the mutating protected Clerk test-instance scenarios. This command denies non-manual, non-protected, SHA-mismatched, production-origin, or non-test-key contexts. |
| `bun run test:e2e:clerk:final-boundary` | `playwright test --config=playwright.clerk.config.ts --grep='final live boundary'` | After Clerk deletion/worker checks, authenticate the persistent boundary fixture and re-prove the exact deployed SHA, database sentinel, and complete migration ledger immediately before evidence. |
| `bun run test:e2e:clerk:verify-deletion` | `bun run src/server/qa/verify-clerk-release-candidate-deletion.ts` | After the protected Closure Operation worker drains, verify the disposable Clerk test identity no longer exists without printing its email or provider response. |
| `bun run test:smoke:trip-pass-stripe` | `bun run src/server/qa/run-stripe-release-candidate.ts` | Run authenticated protected-app Playwright against real Stripe test mode: per-group exact deployed-SHA/database proof, ambiguous retry, return, a distinct 30-minute authoritative expiry boundary, authenticated cancellation, payment, signed webhooks, activation/duplicate/reversed delivery, paid-answer settlement, cumulative refunds, dispute, closure race, and Paid After Closure; then run supplemental contracts. |
| `bun run test:e2e:stripe:final-boundary` | `playwright test --config=playwright.stripe.config.ts --grep='final live boundary'` | After Stripe workers, authenticate the persistent boundary fixture and re-prove the exact deployed SHA, database sentinel, and complete migration ledger immediately before evidence. |
| `bun run qa:provider-rc-evidence` | `bun run src/server/qa/run-provider-release-candidate-evidence.ts` | After a protected provider lane passes, write a SHA- and migration-qualified redacted evidence manifest. Pass `-- --lane clerk` or `-- --lane stripe`. |
| `bun run doctor` | `npx react-doctor@latest` | Run the advisory React Doctor scan locally. |

For a Prospective Candidate, run the complete Foundation Gate:

```sh
bun run verify:foundation
```

`bun run format` is a fix command, not a verification gate. `bun run verify` and `bun run
verify:foundation:local` are non-mutating local verification commands. `bun run verify:foundation`
also creates and removes only run-owned disposable service resources; it does not mutate production
resources or generate trusted-CI evidence. The individual real-service lanes remain available for
focused iteration with the scoped environment configuration documented below.

The provider commands are not normal local or pull-request gates. Dispatch the protected workflow
from the default branch after its requested full SHA is present in `main`; GitHub environment
approval supplies dedicated test-only resources. A normal invocation without that context must
fail before contacting Clerk or Stripe.

## Real Service Integration Lanes

The PostgreSQL and Redis integration lanes require disposable local or explicitly marked remote test
services. They do not use production credentials, provider credentials, PGlite, process-local Redis
fallbacks, or broad cleanup commands such as `FLUSHALL`.

`bun run verify:foundation` uses safe explicitly configured `DATABASE_URL` and `REDIS_URL` services
when both endpoints pass the existing integration safety policy and readiness probes. For any
missing or unavailable service, it requires a running Docker daemon and starts the pinned image
below with a unique container name, run namespace, database name or Redis prefix, and dynamic
loopback port. Normal
completion, failure, SIGINT, and SIGTERM remove only containers recorded as owned by that run.

Start the pinned local PostgreSQL service:

```sh
docker run --rm -d \
  --name ask-siargao-issue150-postgres \
  -e POSTGRES_USER=ask_siargao_issue150 \
  -e POSTGRES_PASSWORD=ask_siargao_issue150_password \
  -e POSTGRES_DB=ask_siargao_issue150 \
  -p 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=512m \
  postgres:17.6-alpine3.22
```

Use the assigned host port from `docker ps`:

```sh
export PGPORT="$(docker port ask-siargao-issue150-postgres 5432/tcp | sed 's/.*://')"
DATABASE_URL="postgres://ask_siargao_issue150:ask_siargao_issue150_password@127.0.0.1:${PGPORT}/ask_siargao_issue150" \
  INTEGRATION_TEST_NAMESPACE=ask_siargao_issue150_local \
  bun run test:integration:postgres
```

Start the pinned local Redis service:

```sh
docker run --rm -d \
  --name ask-siargao-issue150-redis \
  -p 127.0.0.1::6379 \
  redis:8.2.1-alpine3.22
```

Use the assigned host port from `docker ps`:

```sh
export REDISPORT="$(docker port ask-siargao-issue150-redis 6379/tcp | sed 's/.*://')"
REDIS_URL="redis://127.0.0.1:${REDISPORT}/0" \
  INTEGRATION_TEST_NAMESPACE=ask_siargao_issue150_local \
  bun run test:integration:redis
```

Stop the local services when finished:

```sh
docker stop ask-siargao-issue150-postgres ask-siargao-issue150-redis
```

The PostgreSQL harness creates a UUID-suffixed database, records ownership only after `create
database` succeeds, and drops only that database during normal completion or SIGINT/SIGTERM
cleanup. A failed create attempt does not drop a pre-existing database. The Redis harness claims a
UUID-suffixed key prefix with an owner marker and deletes only keys under that prefix during normal
completion or SIGINT/SIGTERM cleanup.

For disposable remote test services, set `INTEGRATION_TEST_ALLOW_REMOTE=1` and make the hostname,
username, database name, or query string visibly contain a test marker such as `test`,
`integration`, `issue`, `local`, or `ci`. Redis database `/0` alone is not a test marker. If a lane
fails before tests run, check that Docker is running, the image tag matches the pinned command, the
published port is the one in the URL, and the URL points at a disposable test service. If a lane
fails during cleanup, rerun the lane with the same service after confirming the reported
UUID-suffixed database or key prefix is the only scoped resource involved.

## Migration Ledger Behavior

`bun run db:migrate` creates `schema_migrations` when needed and records each applied migration
file by filename, SHA-256 checksum, and applied timestamp. Repeat runs skip rows whose filename and
checksum already match the ledger, so historical SQL files are not re-executed.

The production Postgres command takes a deterministic advisory lock before ledger checks and
releases it after success or failure. Each unapplied migration runs in a transaction unless the SQL
contains a statement PostgreSQL cannot run transactionally, such as `CREATE INDEX CONCURRENTLY`.
Run production migrations with the migration credential from the
[database authorization reference](database-authorization.md); the runtime credential should not own
schema objects or write `schema_migrations`.
Production Postgres CLI and job scripts use the shared CLI database profile, which defaults to a
single connection, closes the client in a `finally` path, and honors the `DATABASE_*` connection
options documented in `documentation/developer/reference/environment.md`.

The runner fails before applying new work when the ledger contains an unknown migration, when the
ledger is not an ordered prefix of the migration files, or when an applied migration file checksum no
longer matches the recorded checksum. Logs include applied and skipped migration names and keep
`DATABASE_URL` credentials redacted.

Treat applied files in `drizzle/` as append-only historical records. Do not casually edit an applied
migration to "clean up" DDL or fold in a later schema tweak: a database that already recorded that
file will fail with a checksum mismatch, while a database without the ledger history may execute the
edited SQL as different bootstrap behavior. Put new schema changes in a new numbered migration, and
document any intentional checksum recovery as an operator action with backups and ledger review.

For read-only duplicate-index and unused-index review SQL, see
`documentation/developer/reference/database-index-audits.md`. The #65 hot-path index migration is
additive only and does not drop indexes.

## Google Places Retention Pruning

Schedule `bun run db:prune:google-places` as a recurring maintenance job against the production
`DATABASE_URL`. The job removes expired rows from `google_place_reviews`, `google_place_details`,
and `google_place_snapshots`; it does not remove durable `google_places` identity rows.

Start with a dry run:

```sh
bun run db:prune:google-places -- --dry-run
```

Dry runs count expired rows and print the same per-table progress shape as delete runs, but never
delete rows. The output includes review, detail, snapshot, and total row counts, batch counts, and
whether expired rows remain after the run.

Delete runs use bounded batches to keep locks, WAL bursts, and rollback scope smaller on large
tables:

```sh
bun run db:prune:google-places -- --batch-size 500 --max-batches 20
```

Both options must be positive integers. `--batch-size` defaults to `500`, and `--max-batches`
defaults to `20` per table. If output says more expired rows remain, rerun the command or schedule
another maintenance window with the same controls. Expired reviews are always cleaned up before
snapshot deletion starts; if the review pass reaches `--max-batches` and still has expired rows,
snapshot deletion is skipped for that run and the output reports remaining snapshot work.
