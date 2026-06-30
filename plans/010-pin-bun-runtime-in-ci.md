# 010 - Pin Bun Runtime In CI

Status: ready  
Priority: P2  
Effort: small  
Risk: low  
Depends on: none  
Category: developer workflow and dependency posture  
Planned at: `2026-06-30` against `ccdd368`

> Executor instructions: follow this plan step by step. Run each verification command before
> handing off. If a STOP condition occurs, stop and report instead of expanding scope.
>
> Drift check, run first:
>
> ```sh
> git diff --stat ccdd368..HEAD -- package.json .github/workflows/ci.yml README.md docs documentation AGENTS.md
> ```
>
> If any in-scope file changed since this plan was written, compare the current code to the
> excerpts below before editing.

## Goal

Make the Bun runtime used by GitHub Actions explicit and reviewable. CI should not float on
`bun-version: latest` while the package manifest lacks a `packageManager` field.

## Why This Matters

The lockfile pins dependencies, but CI currently installs whatever Bun release is latest at run
time. Bun runtime changes can alter install, test, TypeScript, or Next.js behavior independently of
the code under review. Pinning the runtime gives maintainers a deliberate upgrade surface.

## Current Evidence

Local runtime observed during planning:

```sh
$ bun --version
1.3.13
```

`package.json:1-6` has no `packageManager` field:

```json
{
  "name": "siargao-portal",
  "version": "0.1.0",
  "private": true,
  "type": "module",
```

`.github/workflows/ci.yml:22-24` floats CI:

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest
```

Existing CI gates in `.github/workflows/ci.yml:26-51` are:

- `bun install --frozen-lockfile`
- `bunx playwright install --with-deps chromium`
- `bun run lint`
- `bun run typecheck --incremental false`
- `bun test`
- `bun run db:migrate:test`
- `bun run db:seed:test`
- `bun run build`
- `bun run test:e2e`

## Commands You Will Need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Runtime check | `bun --version` | Prints the intended pinned version |
| Manifest check | `bun pm pkg get packageManager` | Prints the pinned `bun@...` value after implementation |
| YAML/JSON search | `rg -n "bun-version|packageManager|bun@" package.json .github/workflows README.md docs documentation AGENTS.md` | Shows intended references |
| Lint | `bun run lint` | Exit 0 |
| Typecheck | `bun run typecheck --incremental false` | Exit 0, no errors |
| Unit baseline | `bun test` | Exit 0 after plans 001 and 002 land |

## Scope

In scope:

- `package.json`
- `.github/workflows/ci.yml`
- docs that mention required Bun version, if they already exist

Out of scope:

- Changing dependency versions.
- Editing `bun.lock` unless Bun itself updates metadata as part of a verified package-manager
  metadata change.
- Changing CI gate order.
- Changing `package.json` scripts; plan 006 covers the local `verify` script separately.
- Installing or upgrading Playwright browsers locally.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/010-pin-bun-ci
   ```

2. Confirm the intended Bun version.

   Run:

   ```sh
   bun --version
   ```

   Use the local version unless maintainers explicitly choose another version. During planning the
   observed version was `1.3.13`.

3. Add `packageManager` to `package.json`.

   Add the field near the top-level package metadata:

   ```json
   "packageManager": "bun@1.3.13",
   ```

   Replace `1.3.13` with the version confirmed in step 2 if it differs.

   Verify:

   ```sh
   bun pm pkg get packageManager
   ```

   Expected: `"bun@1.3.13"` or the chosen pinned version.

4. Pin GitHub Actions Bun setup.

   In `.github/workflows/ci.yml`, replace:

   ```yaml
   bun-version: latest
   ```

   with the same version, for example:

   ```yaml
   bun-version: 1.3.13
   ```

   If `oven-sh/setup-bun@v2` supports reading from `packageManager` in the repo version available at
   implementation time, using that documented mode is acceptable. If using a documented mode, cite it
   in the PR summary and keep the manifest as the source of truth.

   Verify:

   ```sh
   rg -n "bun-version: latest|packageManager|bun-version" package.json .github/workflows/ci.yml
   ```

   Expected: no `bun-version: latest`; manifest and workflow agree on the pinned version.

5. Update docs only if a Bun version is already documented.

   Search:

   ```sh
   rg -n "Bun|bun install|bun --version|packageManager" README.md docs documentation AGENTS.md
   ```

   If setup docs mention Bun but not a version, add one short sentence such as:
   "Use Bun `1.3.13`, matching `package.json` and CI." Replace `1.3.13` with the pinned version
   chosen in step 2. Do not create broad onboarding docs in this plan.

6. Run verification.

   ```sh
   bun run lint
   bun run typecheck --incremental false
   bun test
   ```

   Expected: lint and typecheck pass. If `bun test` still shows the known 571 passing / 11 failing
   baseline from plans 001 and 002, record that and do not fix those failures in this plan.

## Test Plan

- No new code tests are required for the metadata/workflow change.
- Run lint and typecheck to catch JSON/YAML formatting issues and repository type drift.
- Run `bun test` as the broad local signal; known failures from plans 001 and 002 are not part of
  this plan.

## Done Criteria

- `package.json` declares `packageManager` with the pinned Bun version, for example
  `"bun@1.3.13"`.
- `.github/workflows/ci.yml` no longer uses `bun-version: latest`.
- The workflow and manifest agree on the Bun version or the workflow reads the manifest through a
  documented setup-bun mode.
- Any existing setup docs that mention Bun are consistent with the pin.
- Lint and typecheck pass.
- `plans/README.md` status row is updated.

## STOP Conditions

Stop and report if:

- The local Bun version differs from CI's required version and there is no maintainer decision about
  which one to pin.
- `bun install --frozen-lockfile` would need to rewrite `bun.lock`.
- setup-bun rejects the selected version syntax in a local/actionlint validation path.
- This change gets entangled with dependency upgrades.

## Maintenance Notes

Future Bun upgrades should be a deliberate one-line manifest/workflow change with the usual CI
gates. Keep plan 006 separate: that plan changes local verification script behavior, while this plan
only pins the runtime.

Suggested commit:

```text
Pin Bun runtime in CI
```
