# Plan 008: Allow route-only intake when origin is absent

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/audit/schemas.ts src/server/audit/completeness-gate.ts src/features/intake/IntakeForm.tsx src/server/audit/intake.test.ts src/server/audit/domain.test.ts tests/e2e/root.e2e.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The product contract says users can provide an arrival route or origin. The schema currently requires `arrivalOrigin`, and the UI has no route selector, so route-only intake is impossible even though the completeness gate already supports it. This is a small, user-visible correctness fix.

## Current State

- `src/server/audit/schemas.ts` defines intake validation.
- `src/server/audit/completeness-gate.ts` expects route or origin.
- `src/features/intake/IntakeForm.tsx` posts intake from the landing page.

Relevant excerpts:

```ts
// src/server/audit/schemas.ts:25
arrivalOrigin: z.string().min(2),
arrivalRouteSlug: z.string().min(1).optional(),
```

```ts
// src/server/audit/completeness-gate.ts:47
if (!input.arrivalOrigin && !input.arrivalRouteSlug) {
  blockingReasons.push("Arrival route or origin is required.");
}
```

```tsx
// src/features/intake/IntakeForm.tsx:85
<Field
  label="Arrival origin"
  name="arrivalOrigin"
  placeholder="Manila or Surigao City"
  required
/>
```

Repo conventions:

- Form fields are plain HTML inputs/selects in `IntakeForm`.
- Destination route options already exist in `siargaoTaxonomy.routes`.
- Tests use `bun:test` and Playwright.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/audit/intake.test.ts src/server/audit/domain.test.ts` | exit 0 |
| E2E | `bun run test:e2e` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/audit/schemas.ts`
- `src/features/intake/IntakeForm.tsx`
- `src/server/audit/intake.test.ts`
- `src/server/audit/domain.test.ts`
- `tests/e2e/root.e2e.ts`

**Out of scope**:

- Rewriting accommodation resolution.
- Adding new destination taxonomy.
- Checkout/payment changes.
- Styling overhaul.

## Git Workflow

- Branch: `advisor/008-route-only-intake`
- Commit message style: `fix: allow route-only audit intake`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Update intake schema

Make `arrivalOrigin` optional and add a refine requiring either `arrivalOrigin` or `arrivalRouteSlug`.

Keep existing date/month refine. Ensure empty strings from the form do not pass as meaningful values; either preprocess empty strings to `undefined` or make the form omit them.

**Verify**: `bun test src/server/audit/domain.test.ts` -> expected failures until tests are updated.

### Step 2: Add route selector to the form

In `IntakeForm`, add a route selector using `siargaoTaxonomy.routes`. Remove `required` from arrival origin. Include `arrivalRouteSlug` in the POST payload when selected.

Keep the form ergonomic:

- origin-only remains valid
- route-only is valid
- missing both shows the existing error path

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 3: Add tests

Add tests for:

- origin-only intake passes
- route-only intake passes
- missing both fails
- UI can submit with route selected and origin blank

Update existing tests if they assume `arrivalOrigin` is always required.

**Verify**:

- `bun test src/server/audit/intake.test.ts src/server/audit/domain.test.ts` -> exit 0
- `bun run test:e2e` -> exit 0

### Step 4: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Use `src/server/audit/intake.test.ts` for service-level behavior and `tests/e2e/root.e2e.ts` for the browser form. The key regression is route-only completeness.

## Done Criteria

- [ ] Intake schema accepts origin-only and route-only submissions.
- [ ] Intake schema rejects submissions with neither origin nor route.
- [ ] Form exposes a route selector and posts `arrivalRouteSlug`.
- [ ] Tests cover origin-only, route-only, and missing-both.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, `bun test`, and relevant e2e pass.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- The route taxonomy has been removed or moved and no route options are available.
- Product requirements changed to require free-text origin only.
- The form change requires a larger design refactor.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

If future provider resolution requires both route and origin for some routes, enforce that in the completeness gate with a specific blocking reason rather than the base schema.

