# Plan 001: Keep Drizzle schema in lockstep with the SQL migration

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/db/schema.ts drizzle/0000_initial_schema.sql src/server/db/migration.test.ts package.json`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The SQL migration creates tables that are not exported through the typed Drizzle schema. That makes upcoming persistence work more likely to use raw SQL or duplicated ad hoc types, especially around candidate entities, reviews, refresh jobs, agent snapshots, LLM tool calls, and provider health. This plan restores one typed source of truth before payment lifecycle and public-page persistence work builds on it.

## Current state

- `drizzle/0000_initial_schema.sql` is the initial database migration.
- `src/server/db/schema.ts` is the typed Drizzle table schema used by `createDatabaseClient`.
- `src/server/db/migration.test.ts` verifies the migration can run in PGlite.

Relevant excerpts:

```ts
// src/server/db/schema.ts:12
export const users = pgTable("users", {
```

```sql
-- drizzle/0000_initial_schema.sql:117
CREATE TABLE IF NOT EXISTS candidate_entities (
```

```sql
-- drizzle/0000_initial_schema.sql:175
CREATE TABLE IF NOT EXISTS reviews (
```

```sql
-- drizzle/0000_initial_schema.sql:299
CREATE TABLE IF NOT EXISTS refresh_jobs (
```

```sql
-- drizzle/0000_initial_schema.sql:341
CREATE TABLE IF NOT EXISTS agent_readable_snapshots (
```

Repo conventions:

- Drizzle table exports are lower camelCase names in `src/server/db/schema.ts`, for example `auditRequests`, `paymentEvents`, and `reviewerResults`.
- JSON columns use `jsonb(...).$type<...>().notNull().default(...)` where practical.
- Tests use `bun:test`; model new assertions after `src/server/db/migration.test.ts`.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `bun run lint` | exit 0, no fixes applied |
| Typecheck | `bun run typecheck --incremental false` | exit 0, no TypeScript errors |
| Tests | `bun test src/server/db/migration.test.ts` | exit 0, database tests pass |
| Full tests | `bun test` | exit 0, all tests pass |

## Scope

**In scope**:

- `src/server/db/schema.ts`
- `src/server/db/migration.test.ts`
- A small helper test file under `src/server/db/` if cleaner than expanding `migration.test.ts`

**Out of scope**:

- Changing `drizzle/0000_initial_schema.sql`
- Adding a new migration
- Reworking runtime database connection behavior
- Implementing repositories or query logic for these tables

## Git Workflow

- Branch: `advisor/001-drizzle-schema-parity`
- Commit message style: conventional commits, for example `fix: align drizzle schema with migration`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add missing Drizzle exports

In `src/server/db/schema.ts`, add exports for every table present in `drizzle/0000_initial_schema.sql` but absent from the typed schema. At minimum include:

- `candidateEntities`
- `entityMatches`
- `reviews`
- `factConfidenceScores`
- `sourceCredibilityScores`
- `factConflicts`
- `refreshJobs`
- `agentReadableSnapshots`
- `llmToolCalls`
- `providerHealthChecks`

Match column names, nullability, defaults, and references from the migration. Use the same import style already in `schema.ts`; add missing Drizzle column builders only as needed.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 2: Add schema/migration parity coverage

Add a test that makes drift visible. A pragmatic approach is to parse `CREATE TABLE IF NOT EXISTS <table>` names from `drizzle/0000_initial_schema.sql` and compare them to the table names exported by `src/server/db/schema.ts`.

If Drizzle's table-name symbol is awkward to inspect, keep the parser simple and maintain a local array of exported table objects in the test. The goal is a failing test when a migration table has no typed schema export.

**Verify**: `bun test src/server/db/migration.test.ts` -> exit 0 and includes the new parity assertion.

### Step 3: Run full local gates for this change

Run the relevant repo gates.

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

- Add or extend `src/server/db/migration.test.ts`.
- Cover: the migration runs, every migrated table has a typed Drizzle export, and no added schema export breaks TypeScript.
- Use the existing PGlite migration test structure in `src/server/db/migration.test.ts` as the pattern.

## Done Criteria

- [ ] Every table in `drizzle/0000_initial_schema.sql` has a corresponding typed export in `src/server/db/schema.ts`.
- [ ] A parity test fails if a migrated table lacks a schema export.
- [ ] `bun run lint` exits 0.
- [ ] `bun run typecheck --incremental false` exits 0.
- [ ] `bun test` exits 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- The SQL migration has changed materially from the excerpts above.
- Matching the migration requires changing SQL rather than adding typed schema.
- Drizzle cannot represent a migrated column without changing runtime behavior.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Future migrations should update `src/server/db/schema.ts` in the same change. Reviewers should scrutinize column defaults, foreign keys, and JSON types for exact parity rather than just table presence.

