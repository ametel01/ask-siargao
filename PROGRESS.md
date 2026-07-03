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

- Current step: #71 Document database authorization boundaries.
- Status: implementation complete; checker review pending.
- Next step: #72 Add database operations runbook after #65, #69, #70, and #71 are ready.
- Last updated: 2026-07-03.

## Step Checklist

| Issue | Step | Status | Dependency state | Notes |
| --- | --- | --- | --- | --- |
| #61 | Initialize database hardening progress tracking | Complete | Unblocked root step | Created this progress tracker and verified the existing changelog structure. |
| #62 | Make database migrations ledger-backed | Complete pending checker | Ready; #61 complete | Added the ledger-backed runner, drift checks, advisory-lock production path, docs, and tests. |
| #63 | Guard historical bootstrap migration behavior | Blocked | Blocked by #62 checker/merge; #61 complete | Must build on the ledger-backed migration runner. |
| #64 | Add database constraints and foreign key indexes | Blocked | Blocked by #62 checker/merge; #61 complete | Requires production-safe migrations first. |
| #65 | Add hot path indexes and index audit guidance | Blocked | Blocked by #62 and #64; #61 complete | Depends on constraint/index groundwork. |
| #66 | Bound database-backed list queries | Blocked | Blocked by #65; #61 complete | Depends on hot-path index work. |
| #67 | Normalize public page evidence relationships | Blocked | Blocked by #62 and #64; #61 complete | Requires migration and constraint groundwork. |
| #68 | Batch saved-trip and provider write paths | Blocked | Blocked by #64; #61 complete | Depends on database constraint/index groundwork. |
| #69 | Batch Google Places retention cleanup | Blocked | Blocked by #65; #61 complete | Depends on hot-path index work. |
| #70 | Define production database connection options | Pending | Ready; #61 complete | Can proceed after tracking setup. |
| #71 | Document database authorization boundaries | Complete pending checker | Ready; #61 and #62 complete on this stacked branch | Added tested role/grant SQL template, credential docs, and an RLS deferral decision record. |
| #72 | Add database operations runbook | Blocked | Blocked by #65, #69, #70, and #71; #61 complete | Final runbook depends on earlier operational controls. |

## Validation Evidence

- #71 implementation:
  - `bun install --frozen-lockfile`: Passed after the new worktree initially lacked local
    `node_modules`.
  - `bun test src/server/db/authorization-boundaries.test.ts`: Passed with 4 tests and 27
    assertions covering separated migration/runtime/reporting roles, broad `PUBLIC` privilege
    revokes, default privilege grants, current table sets, runtime exclusion from
    `schema_migrations`, and unsafe identifier rejection.
  - `bun run format`: Passed; final run reported no fixes.
  - `bun run lint`: Passed; Biome checked 288 files with no fixes applied.
  - `bun run typecheck --incremental false`: Passed.
  - `bun test`: Passed with 746 tests and 3,937 assertions.
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
- 2026-07-03: Completed #61 tracking setup and lint validation. No `CHANGELOG.md` entry was added
  because this step is non-functional tracking scaffolding.
