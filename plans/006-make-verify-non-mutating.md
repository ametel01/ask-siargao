# 006 - Make Local Verification Non-Mutating And CI-Aligned

Status: complete
Priority: P2  
Effort: small  
Risk: low  
Depends on: none
Category: developer workflow  
Planned at: `2026-06-30` against `a9d1775`

## Goal

Make the repository's local verification command non-mutating and aligned with CI quality gates.
Formatting writes should stay in `bun run format`, not happen inside verification.

## Evidence At Planning Time

At commit `a9d1775`, `package.json` defined:

```json
"verify": "bun run format && bun run lint && bun run typecheck && bun run test"
```

Problems observed at that point:

- `verify` mutates files through `bun run format`;
- `typecheck` does not force a clean incremental-free check;
- the command is narrower than CI, which also runs test database migrate/seed, build, and e2e.

CI then ran:

- `bun run lint`
- `bun run typecheck --incremental false`
- `bun test`
- `bun run db:migrate:test`
- `bun run db:seed:test`
- `bun run build`
- `bun run test:e2e`

## In Scope

- `package.json`
- Developer docs that mention verification scripts, for example README or files under
  `documentation/developer`

## Out of Scope

- Changing CI workflow semantics.
- Replacing Biome.
- Fixing unrelated test failures, if any are introduced before this plan is executed.
- Adding paid-pass or revenue-model checks.

## Completed Script Shape

The repository keeps fast iteration distinct from complete Foundation Gate verification:

```json
"verify": "bun run lint && bun run typecheck --incremental false && bun test",
"verify:foundation:local": "bun run src/server/qa/run-foundation-local.ts",
"verify:foundation": "bun run src/server/qa/run-foundation.ts"
```

The local Foundation command runs the eight repository-only gates. The complete command adds the
real PostgreSQL and Redis lanes for all ten Foundation Gates.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/006-non-mutating-verify
   ```

2. Inspect scripts and docs:

   ```sh
   rg -n '"verify"|bun run verify|bun run format|typecheck --incremental' package.json README.md documentation AGENTS.md
   ```

3. Update `package.json`:

   - remove `bun run format` from `verify`;
   - use `bun run typecheck --incremental false`;
   - expose the local and complete Foundation Gate commands without duplicating their gate graphs.

4. Update docs that mention local checks:

   - `bun run format` writes formatting fixes;
   - `bun run lint` is non-mutating;
   - `bun run verify` is safe to run without rewriting files;
   - `bun run verify:foundation:local` runs the eight local gates;
   - `bun run verify:foundation` runs the complete ten-gate workflow.

5. Do not update `.github/workflows/ci.yml` unless inspection finds it has drifted.

## Verification

Run:

```sh
bun run verify
git diff --check
git status --short
```

For the complete Foundation Gate, also run:

```sh
bun run verify:foundation
```

Expected:

- verification passes;
- `git status --short` shows no formatting-only changes caused by verification;
- docs match the final script names.

At `a9d1775`, the full `bun test` baseline is green, so `bun run verify` should pass after the
script is made non-mutating unless this plan introduces a regression.

## Done Criteria

- `verify` no longer runs a mutating formatter.
- `verify` uses `typecheck --incremental false`.
- Local scripts and docs clearly distinguish checking from formatting.
- Full CI-equivalent validation is available from a documented script.

## Stop Conditions

Stop and ask for a workflow decision if:

- maintainers intentionally want `verify` to format files;
- e2e/build are too slow for `verify` and there is no appetite for separate Foundation Gate
  commands;
- CI workflow has changed enough that script alignment needs a broader discussion.

## Suggested Commit

```text
Make verify non mutating
```
