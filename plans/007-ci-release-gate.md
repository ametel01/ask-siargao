# Plan 007: Automate the release gate in CI

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- .github/workflows package.json README.md documentation/developer/reference/scripts.md documentation/developer/how-to-guides/run-release-candidate-qa.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The docs list a release-candidate gate, but GitHub currently has only an advisory React Doctor workflow. Payment gating, public/private boundaries, type safety, tests, and Playwright flows can regress without a required CI check catching them. This plan adds a non-mutating CI gate and aligns docs so future agents do not use `biome format --write .` as verification.

## Current State

- `.github/workflows/react-doctor.yml` is currently staged/new in the worktree and advisory by design.
- `package.json` scripts include lint, typecheck, tests, build, e2e, and mutating format.
- Docs list `bun run format` as part of quality gates even though it writes files.

Relevant excerpts:

```json
// package.json:11
"format": "biome format --write .",
"lint": "biome check .",
"typecheck": "tsc --noEmit",
"test": "bun test",
"test:e2e": "playwright test",
```

```yaml
# .github/workflows/react-doctor.yml:34
- uses: millionco/react-doctor@v2
```

```md
<!-- documentation/developer/how-to-guides/run-release-candidate-qa.md:9 -->
bun run format
bun run lint
bun run typecheck
```

Repo conventions:

- Package manager is Bun.
- Build scripts generate Panda artifacts before Next build.
- `bun run lint` is non-mutating: the audit verified it runs `biome check .` and exits 0.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `bun run lint` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Unit tests | `bun test` | exit 0 |
| Build | `bun run build` | exit 0 |
| E2E | `bun run test:e2e` | exit 0 |

## Scope

**In scope**:

- `.github/workflows/ci.yml` (create)
- `.github/workflows/react-doctor.yml` only if needed to avoid duplicate names or clarify advisory status
- `package.json`
- `README.md`
- `documentation/developer/reference/scripts.md`
- `documentation/developer/how-to-guides/run-release-candidate-qa.md`

**Out of scope**:

- Changing application source code.
- Making React Doctor blocking.
- Dependency upgrades.
- Rewriting all docs.

## Git Workflow

- Branch: `advisor/007-ci-release-gate`
- Commit message style: `ci: add release gate workflow`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add non-mutating format/check script if needed

If `bun run lint` is sufficient as the non-mutating Biome gate, document that and do not add another script. If a distinct format check is preferred, add a script such as:

```json
"format:check": "biome format --check ."
```

Do not replace `format`; keep it as the intentional write command.

**Verify**: `bun run lint` or `bun run format:check` -> exit 0.

### Step 2: Add CI workflow

Create `.github/workflows/ci.yml` that runs on pull requests and pushes to `main`. Use Bun setup, install dependencies, and run:

- non-mutating format/lint check
- `bun run typecheck --incremental false`
- `bun test`
- `bun run build`
- `bun run test:e2e`

Include Playwright browser installation if required by the CI environment. Use caching only if it is straightforward and does not obscure failures.

**Verify**: YAML parses by inspection and local commands listed above pass.

### Step 3: Update docs to separate check from write

Update README and developer docs so:

- `bun run format` is described as a fix command, not a verification gate.
- CI/release gates use the non-mutating check command.
- React Doctor is described as advisory unless the workflow is explicitly changed.

**Verify**: `rg -n "bun run format" README.md documentation/developer` -> remaining references clearly say it writes/fixes, not that it is required for clean verification.

### Step 4: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0
- If environment can support it, `bun run build` and `bun run test:e2e` -> exit 0. If they cannot run locally, document the blocker in the final handoff.

## Test Plan

This is CI/tooling work. The test is the workflow command list and local execution of the same commands where feasible.

## Done Criteria

- [ ] A CI workflow runs the release gate on PRs and pushes to `main`.
- [ ] The gate includes non-mutating lint/format check, typecheck, unit tests, build, and Playwright e2e.
- [ ] Docs no longer present `bun run format` as a clean verification command.
- [ ] Local `bun run lint`, `bun run typecheck --incremental false`, and `bun test` pass.
- [ ] No application source files are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Existing staged workflow changes conflict with this plan and ownership is unclear.
- CI requires secrets or external services not present in docs.
- Local gates fail for unrelated existing reasons.
- The fix requires changing app behavior.

## Maintenance Notes

Keep React Doctor as a separate advisory signal unless the team explicitly decides to make it blocking. Build and e2e may write artifacts locally; CI should run them in a clean checkout.

