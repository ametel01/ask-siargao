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

- Current step: #67 Normalize public page evidence relationships.
- Status: implementation complete; checker and reviewer-agent review complete.
- Next step: Continue #69 retention cleanup, #68 batched write paths, and #71 authorization
  boundaries before the #72 operations runbook.
- Last updated: 2026-07-03.

## Step Checklist

| Issue | Step | Status | Dependency state | Notes |
| --- | --- | --- | --- | --- |
| #61 | Initialize database hardening progress tracking | Complete | Unblocked root step | Created this progress tracker and verified the existing changelog structure. |
| #62 | Make database migrations ledger-backed | Complete pending checker | Ready; #61 complete | Added the ledger-backed runner, drift checks, advisory-lock production path, docs, and tests. |
| #63 | Guard historical bootstrap migration behavior | Complete pending checker | Ready on #62 stack; #61 complete | Added targeted repeat-run coverage for the historical saved-trip primary-key rewrite plus checksum/ledger docs. |
| #64 | Add database constraints and foreign key indexes | Complete pending checker | Ready on #63 stack; #61 complete | Added the hardening migration, schema metadata, and migration tests for supporting indexes and CHECK constraints. |
| #65 | Add hot path indexes and index audit guidance | Complete pending checker | Ready on #64 stack; #61 complete | Added hot-path indexes, destructive-DDL scope tests, read-only index audit SQL, and documented deliberate exceptions. |
| #66 | Bound database-backed list queries | Blocked | Blocked by #65 checker/merge; #61 complete | Depends on hot-path index work. |
| #67 | Normalize public page evidence relationships | Complete pending checker | Ready on #65 stack; #61 complete | Added normalized public-page fact and evidence relationship tables, ordered backfill, catalog fallback/preference reads, and regression tests. |
| #68 | Batch saved-trip and provider write paths | Blocked | Blocked by #64; #61 complete | Depends on database constraint/index groundwork. |
| #69 | Batch Google Places retention cleanup | Blocked | Blocked by #65; #61 complete | Depends on hot-path index work. |
| #70 | Define production database connection options | Complete pending checker | Ready on #64 stack; #61 complete | Added shared Postgres option parsing, app/CLI profiles, CLI close-path coverage by inspection, docs, and tests. |
| #71 | Document database authorization boundaries | Blocked | Blocked by #62; #61 complete | Requires migration posture before role/grant documentation. |
| #72 | Add database operations runbook | Blocked | Blocked by #65, #69, #70, and #71; #61 complete | Final runbook depends on earlier operational controls. |

## Validation Evidence

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
- 2026-07-03: Completed #67 normalized public-page relationship implementation. Updated
  `CHANGELOG.md` with the additive migration and catalog compatibility behavior change.
- 2026-07-03: Completed #61 tracking setup and lint validation. No `CHANGELOG.md` entry was added
  because this step is non-functional tracking scaffolding.
