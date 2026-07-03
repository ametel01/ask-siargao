# Database Hardening Progress

This file tracks the production database readiness work from issue #61 through issue #72. Update
it after each completed step with validation results, commit references when available, current
status, and the next implementation step.

## Sources

- GitHub issue sequence: #61 through #72.
- Source plan: `PLAN.md`, generated from the July 3, 2026 production database readiness brief.
- Changelog policy: `CHANGELOG.md` follows Keep a Changelog 1.0.0 and is updated only for
  validated functional changes.

## Current Status

- Current step: #72 Add database operations runbook.
- Status: implementation complete; local validation and reviewer-agent review complete.
- Next step: merge #72 and close the database-hardening plan.
- Last updated: 2026-07-03.

## Step Checklist

| Issue | Step | Status | Dependency state | Notes |
| --- | --- | --- | --- | --- |
| #61 | Initialize database hardening progress tracking | Complete | Unblocked root step | Created this progress tracker and verified the existing changelog structure. |
| #62 | Make database migrations ledger-backed | Complete pending checker | Ready; #61 complete | Added the ledger-backed runner, drift checks, advisory-lock production path, docs, and tests. |
| #63 | Guard historical bootstrap migration behavior | Complete pending checker | Ready on #62 stack; #61 complete | Added targeted repeat-run coverage for the historical saved-trip primary-key rewrite plus checksum/ledger docs. |
| #64 | Add database constraints and foreign key indexes | Complete pending checker | Ready on #63 stack; #61 complete | Added the hardening migration, schema metadata, and migration tests for supporting indexes and CHECK constraints. |
| #65 | Add hot path indexes and index audit guidance | Complete pending checker | Ready on #64 stack; #61 complete | Added hot-path indexes, destructive-DDL scope tests, read-only index audit SQL, and documented deliberate exceptions. |
| #66 | Bound database-backed list queries | Complete pending checker | Ready on #67 stack; #61 complete | Added capped chat thread pagination plus bounded public catalog parent/fact/evidence reads. |
| #67 | Normalize public page evidence relationships | Complete pending checker | Ready on #65 stack; #61 complete | Added normalized public-page fact and evidence relationship tables, ordered backfill, catalog fallback/preference reads, and regression tests. |
| #68 | Batch saved-trip and provider write paths | Complete pending checker | Ready on #69 stack; #61 complete | Added bounded multi-row saved-trip and provider write batches with focused rollback/order coverage. |
| #69 | Batch Google Places retention cleanup | Complete pending checker | Ready on #65 stack; #61 complete | Added bounded retention delete batches, CLI controls, progress output, docs, and pruning tests. |
| #70 | Define production database connection options | Complete pending checker | Ready on #64 stack; #61 complete | Added shared Postgres option parsing, app/CLI profiles, CLI close-path coverage by inspection, docs, and tests. |
| #71 | Document database authorization boundaries | Complete pending checker | Ready; #61 and #62 complete on this stacked branch | Added tested role/grant SQL template, credential docs, and an RLS deferral decision record. |
| #72 | Add database operations runbook | Complete pending merge | Ready; #65, #69, #70, and #71 merged | Added production database provisioning, observability, maintenance, backup/PITR, restore drill, and incident guidance. |

## Validation Evidence

- #71 implementation:
  - `bun install --frozen-lockfile`: Passed after the new worktree initially lacked local
    `node_modules`.
  - `bun test src/server/db/authorization-boundaries.test.ts`: Passed with 4 tests and 28
    assertions covering separated migration/runtime/reporting roles, broad `PUBLIC` privilege
    revokes, default privilege grants, current table sets, runtime exclusion from
    `schema_migrations`, reporting future-table default exclusion, and unsafe identifier rejection.
  - `bun run format`: Passed; final run reported no fixes.
  - `bun run lint`: Passed; Biome checked 288 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 746 tests and 3,938 assertions.
  - SQL template smoke test with `bun -e`: Passed; generated SQL includes runtime role and
    `schema_migrations` ownership boundaries without printing secrets.
- #62 implementation:
  - `bun test src/server/db/migration.test.ts`: Passed with 10 tests covering first run, idempotent
    second run, skipped SQL, checksum mismatch, out-of-order drift, unknown ledger rows, ledger
    contents, and existing parity checks.
  - `bun run db:migrate:test`: Passed; migrated 48 PGlite tables and recorded 3 migrations.
  - `bun run db:seed:test`: Passed; seeded 5 areas, 3 routes, and 6 source profiles.
  - `bun run format`: Passed with no fixes needed on the final run.
  - `bun run lint`: Passed; Biome checked 286 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 742 tests.
  - `bun run verify:ci`: Passed; repeated lint/typecheck/unit tests, PGlite migrate/seed, build,
    and 38 Playwright tests.
- #63 implementation:
  - `bun test src/server/db/migration.test.ts`: Passed with 11 tests, including targeted coverage
    that fails if the `saved_trip_items` primary-key rewrite in `0000_initial_schema.sql` executes
    on the second ledger-backed run.
  - `bun run format`: Passed with no fixes applied.
  - `bun run lint`: Passed; Biome checked 286 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun run db:migrate:test`: Passed; migrated 48 PGlite tables and recorded 3 migrations.
  - `bun run verify:ci`: Passed; repeated lint/typecheck/Bun tests, PGlite migrate/seed, build,
    and 38 Playwright tests. Playwright web-server logs still emitted the pre-existing missing
    `DATABASE_URL` saved-trip route noise, but the suite passed.
  - No `CHANGELOG.md` entry was added because #63 changed tests and documentation only, not runtime
    migration behavior.
- #64 implementation:
  - `bun test src/server/db/migration.test.ts`: Passed with 14 tests, including coverage for the
    new ledger-backed hardening migration, supporting index inventory, high-risk CHECK constraint
    inventory, and representative invalid enum, range, counter, and timestamp writes.
  - `bun run db:migrate:test`: Passed; migrated 48 PGlite tables and recorded 4 migrations.
  - `bun run db:seed:test`: Passed; seeded 5 areas, 3 routes, and 6 source profiles.
  - `bun run format`: Passed with no fixes applied on the final run.
  - `bun run lint`: Passed; Biome checked 286 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 746 tests.
  - `bun run verify:ci`: Passed; repeated lint/typecheck/Bun tests, PGlite migrate/seed, build,
    and 38 Playwright tests. Playwright web-server logs still emitted the pre-existing missing
    `DATABASE_URL` saved-trip route noise, but the suite passed.
- #65 implementation:
  - `bun test src/server/db/migration.test.ts`: Passed with 16 tests, including hot-path index
    inventory coverage through `pg_indexes` and a negative check that `0004_hot_path_indexes.sql`
    contains no destructive DROP/index/table/column DDL.
  - `bun run db:migrate:test`: Passed; migrated 48 PGlite tables and recorded 5 migrations.
  - `bun run db:seed:test`: Passed; seeded 5 areas, 3 routes, and 6 source profiles.
  - `bun run format`: Passed with no fixes applied.
  - `bun run lint`: Passed; Biome checked 286 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 748 tests.
  - `bun run verify:ci`: Passed; repeated lint/typecheck/Bun tests, PGlite migrate/seed, build,
    and 38 Playwright tests. Playwright web-server logs still emitted the pre-existing missing
    `DATABASE_URL` saved-trip route noise, but the suite passed.
- #67 implementation:
  - `bun test src/server/db/migration.test.ts`: Passed with 18 tests, including relationship
    table column/key/FK/delete-rule/index/check coverage and ordered backfill from legacy JSON
    arrays with duplicate legacy IDs keeping the first position.
  - `bun test src/server/public-pages/database-public-catalog.test.ts`: Passed with 6 tests,
    including normalized reads, legacy fallback, normalized-over-legacy precedence,
    non-alphabetic ordering, and missing-evidence behavior.
  - `bun run db:migrate:test`: Passed; migrated 50 PGlite tables and recorded 6 migrations.
  - `bun run db:seed:test`: Passed; seeded 5 areas, 3 routes, and 6 source profiles.
  - `bun run format`: Passed; Biome formatted 285 files and fixed 2 files.
  - Final `bun run format`: Passed with no fixes applied.
  - `bun run lint`: Passed; Biome checked 286 files with no fixes applied after fixing import
    order.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 754 tests and 3,958 assertions.
- #69 implementation:
  - `bun test src/server/jobs/prune-google-places.test.ts`: Passed with 6 tests covering dry-run
    counts, bounded repeated delete runs, snapshot skipping while expired reviews remain, count-only
    delete query shape, CLI validation, and operator progress formatting.
  - `bun test src/server/providers/google-places-store.test.ts`: Passed with 5 tests, including
    backwards-compatible direct cleanup helper behavior.
  - `bun run format`: Passed with no fixes applied on the final run.
  - `bun run lint`: Passed; Biome checked 286 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 753 tests and 3,951 assertions.
- #70 implementation:
  - `bun test src/server/db/connection-options.test.ts`: Passed with 17 tests covering local
    defaults, production defaults, SSL modes, invalid values, shared timeout/lifetime overrides,
    and app versus CLI profile differences.
  - Direct `postgres(...)` call-site inspection: Passed; every direct call uses
    `createPostgresConnectionOptions("app")` or `createPostgresConnectionOptions("cli")`, CLI/job
    call sites use the CLI profile, and CLI-profile clients close with `sql.end()` in existing
    `finally` paths.
  - Existing local facts query statement timeout was preserved through the scoped
    `set_config('statement_timeout', ...)` call.
  - `bun run format`: Passed with no fixes applied.
  - `bun run lint`: Passed; Biome checked 288 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 763 tests.
  - `bun run db:migrate:test`: Passed after rerunning sequentially; migrated 48 PGlite tables and
    recorded 4 migrations. An earlier concurrent run with `db:seed:test` failed due PGlite
    filesystem/schema ordering and was not a code failure.
  - `bun run db:seed:test`: Passed after sequential `db:migrate:test`; seeded 5 areas, 3 routes,
    and 6 source profiles. An earlier concurrent run failed because the schema was not yet created.
  - `bun run verify:ci`: Passed; repeated lint/typecheck/Bun tests, PGlite migrate/seed, build,
    and 38 Playwright tests. Playwright web-server logs still emitted the pre-existing missing
    `DATABASE_URL` saved-trip route noise, but the suite passed.
- #66 implementation:
  - `bun test src/app/api/chat/threads/route.test.ts`: Passed with 12 tests, including default
    list caps, bounded custom limits, cursor traversal, deterministic thread-id tie ordering, and
    no-parameter compatibility.
  - `bun test src/server/public-pages/database-public-catalog.test.ts`: Passed with 8 tests,
    including finite default/custom public catalog caps, max-limit clamping, normalized
    relationship compatibility, legacy fallback compatibility, and deterministic limited-page
    ordering.
  - `bun test src/app/api/public/public-index-routes.test.ts`: Passed with 1 test covering
    compatible public entity/evidence/risk-preview route payloads through the catalog.
  - `bun run format`: Passed with no fixes applied on the final run.
  - `bun run lint`: Passed; Biome checked 286 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 760 tests and 3,989 assertions.
  - `bun run verify:ci`: Passed; repeated lint/typecheck/Bun tests, PGlite migrate/seed, build,
    and 38 Playwright tests. Playwright web-server logs still emitted the pre-existing missing
    `DATABASE_URL` saved-trip route noise, but the suite passed.
- #68 implementation:
  - `bun test src/server/trips/shared-trip-store.test.ts`: Passed with 12 tests covering batched
    saved-trip item writes, request ordering, empty input, conflict update/undelete, duplicate IDs
    with later entries winning, and no partial insert on validation or FK errors.
  - `bun test src/app/api/trips/route.test.ts`: Passed with 10 saved-trip API route tests.
  - `bun test src/server/providers/google-places-store.test.ts src/server/providers/enrich-google-places.test.ts src/server/providers/open-meteo.test.ts src/server/providers/open-meteo-marine.test.ts`:
    Passed with 23 tests covering batched Google Places reviews/facts/evidence, bad review row
    no-partial behavior, Open-Meteo weather/marine fact graph batching, FK ordering, and transaction
    rollback.
  - `bun run format`: Passed with no fixes applied on the final focused run.
  - `bun run lint`: Passed; Biome checked 287 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun run db:migrate:test`: Passed; migrated 48 PGlite tables and recorded 5 migrations.
  - `bun run db:seed:test`: Passed; seeded 5 areas, 3 routes, and 6 source profiles.
  - `bun test`: Passed with 761 tests and 3,984 assertions.
  - `bun run verify:ci`: Passed; repeated lint/typecheck/Bun tests, PGlite migrate/seed, production
    build, and 38 Playwright tests. Playwright web-server logs still emitted the pre-existing
    missing `DATABASE_URL` saved-trip route noise, but the suite passed.
- #72 implementation:
  - Added `documentation/developer/how-to-guides/operate-the-production-database.md` covering
    provisioning, monitoring, maintenance cadence, retention cleanup, duplicate/unused-index
    review, migration failure handling, backup/PITR targets, restore drills, validation queries,
    and incident response.
  - Linked the runbook from `documentation/developer/README.md` and the local Postgres guide.
  - No `CHANGELOG.md` entry was added because #72 is documentation-only.
  - `bun install --frozen-lockfile`: Passed after the new worktree initially lacked local
    `node_modules`.
  - `git diff --check`: Passed.
  - `bun run lint`: Passed; Biome checked 291 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
- `CHANGELOG.md` inspection: Existing file contains `# Changelog`, a Keep a Changelog 1.0.0
  preamble, an `## [Unreleased]` section, and no empty category headings.
- `PROGRESS.md` inspection: This file lists every database hardening issue from #61 through #72,
  marks #61 complete, records #62 implementation evidence, identifies #63 as the next step, and
  records later blockers from the GitHub dependency graph.
- `bun run lint`: Passed after installing missing local dependencies with `bun install`.
  - First attempt: failed before linting because `node_modules` was absent and `biome` was not
    found.
  - Subsequent attempts passed, with Biome checking 285 files and reporting no fixes applied.

## Update Log

- 2026-07-03: Completed #71 database authorization documentation and validation. Updated
  `CHANGELOG.md` with the role/grant and RLS decision record.
- 2026-07-03: Completed #62 ledger-backed migration implementation and validation. Updated
  `CHANGELOG.md` with the migration behavior change.
- 2026-07-03: Completed #63 historical bootstrap migration guard coverage and docs. No
  `CHANGELOG.md` entry was added because runtime behavior did not change.
- 2026-07-03: Completed #64 database hardening constraints and supporting index implementation.
  Updated `CHANGELOG.md` with the migration behavior change.
- 2026-07-03: Completed #70 production database connection option implementation and validation.
  Updated `CHANGELOG.md` with the client configuration behavior change.
- 2026-07-03: Completed #65 hot-path index implementation and read-only index audit guidance.
  Updated `CHANGELOG.md` with the additive migration behavior change.
- 2026-07-03: Completed #66 bounded database-backed list query implementation. Updated
  `CHANGELOG.md` with the chat thread pagination and public catalog bounded-read behavior change.
- 2026-07-03: Completed #67 normalized public-page relationship implementation. Updated
  `CHANGELOG.md` with the additive migration and catalog compatibility behavior change.
- 2026-07-03: Completed #69 Google Places retention pruning batches, CLI controls, docs, and
  focused pruning tests. Updated `CHANGELOG.md` with the operator-visible pruning behavior change.
- 2026-07-03: Completed #68 saved-trip and provider write batching with focused ordering,
  duplicate-key, FK-ordering, and rollback coverage. Updated `CHANGELOG.md` with the write-path
  behavior change.
- 2026-07-03: Completed #72 production database operations runbook and documentation links. No
  `CHANGELOG.md` entry was added because this step is documentation-only.
- 2026-07-03: Completed #61 tracking setup and lint validation. No `CHANGELOG.md` entry was added
  because this step is non-functional tracking scaffolding.
