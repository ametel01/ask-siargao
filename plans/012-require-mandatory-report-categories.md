# Plan 012: Require every mandatory report category in validation

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/audit/schemas.ts src/server/audit/report-validation.ts src/server/audit/risk-report.test.ts docs/PRD.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S/M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The paid report promise says every audit evaluates the mandatory risk categories. The current report schema only requires `fullRiskTable` to contain at least one item, and deterministic validation only validates risks that are present. A generated report can omit weather, area fit, internet/power, transport, cash/SIM/services, or health/admin categories and still pass publication validation.

## Current State

- `src/server/audit/schemas.ts` defines report output shape.
- `src/server/audit/report-validation.ts` performs deterministic publication checks.
- `src/server/audit/risk-report.test.ts` is the existing test file for report validation.
- `docs/PRD.md` records the product/testing requirement.

Relevant excerpts:

```ts
// src/server/audit/schemas.ts:74
topRisks: z.array(riskItemSchema).min(1).max(3),
fullRiskTable: z.array(riskItemSchema).min(1),
```

```ts
// src/server/audit/report-validation.ts:45
for (const risk of report.fullRiskTable) {
  validateRisk(risk, bundleEvidenceIds, errors);
}
```

```md
<!-- docs/PRD.md:200 -->
- Test that the report includes the mandatory risk categories for every audit.
```

Repo conventions:

- Risk categories are centralized in `src/server/audit/enums.ts` as `riskCategories`.
- Existing validation errors use stable string prefixes such as `schema:`, `evidence:`, `freshness:`, and `confidence:`.
- Existing tests use `bun:test` in `src/server/audit/risk-report.test.ts`.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/audit/risk-report.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/audit/report-validation.ts`
- `src/server/audit/risk-report.test.ts`
- `src/server/audit/schemas.ts` only if schema-level enforcement is cleaner than validator-level enforcement

**Out of scope**:

- Changing the set of mandatory categories.
- Changing risk ranking.
- Changing report UI layout.
- Rewriting LLM prompts or reviewer prompts.
- Provider/source freshness work; that is handled by other plans.

## Git Workflow

- Branch: `advisor/012-require-mandatory-report-categories`
- Commit message style: `fix: require mandatory report categories`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a failing validation test for omitted categories

In `src/server/audit/risk-report.test.ts`, add a test under `describe("report validation", ...)` proving a report with only `arrival_departure_logistics` in `fullRiskTable` fails validation.

Use the existing `validReport()` helper as the starting point. The current helper already creates only one route risk; after this plan is complete, that helper must be changed so the normal "accepts a paid report with valid evidence" test remains valid.

Expected error shape: use a stable prefix such as `category:<category>:missing mandatory report category.` for each missing category, or one aggregate error such as `category:missing mandatory report categories:...`. Pick one and assert it exactly.

**Verify**: `bun test src/server/audit/risk-report.test.ts` -> fails for the new missing-category assertion until implementation is added.

### Step 2: Enforce mandatory category coverage

In `src/server/audit/report-validation.ts`, import `riskCategories` from `src/server/audit/enums.ts`. After parsing `report`, compare the set of `report.fullRiskTable.map((risk) => risk.category)` with every category in `riskCategories`.

Behavior to implement:

- every category in `riskCategories` must appear at least once in `fullRiskTable`
- `topRisks` may remain a ranked subset of one to three risks
- duplicate categories in `fullRiskTable` should not satisfy missing categories
- keep the existing per-risk validation for evidence and explanation fields

Recommended implementation shape:

```ts
const reportCategories = new Set(report.fullRiskTable.map((risk) => risk.category));
for (const category of riskCategories) {
  if (!reportCategories.has(category)) {
    errors.push(`category:${category}:missing mandatory report category.`);
  }
}
```

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 3: Update valid report fixtures

Update the `validReport()` helper in `src/server/audit/risk-report.test.ts` so `fullRiskTable` includes one risk for every mandatory category. Use the existing `risk(overrides)` helper and vary only `id`, `category`, and `title` as needed.

Keep `topRisks` at one to three items. The goal is not to expand the top risks; it is to ensure the full risk table covers the mandatory set.

Add a positive assertion that a complete category set passes:

- `validateReportForPublication(...).valid` is `true`
- the full table contains the same category set as `riskCategories`

**Verify**: `bun test src/server/audit/risk-report.test.ts` -> exit 0.

### Step 4: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Add or update tests in `src/server/audit/risk-report.test.ts`:

- complete reports with all mandatory categories pass
- reports missing one or more mandatory categories fail with stable category errors
- `topRisks` remains allowed to contain a subset of one to three risks

Use the existing validation tests in the same file as the structural pattern.

## Done Criteria

- [ ] `validateReportForPublication` fails reports whose `fullRiskTable` omits any category from `riskCategories`.
- [ ] `topRisks` remains a subset and does not need every mandatory category.
- [ ] `src/server/audit/risk-report.test.ts` covers both complete and missing-category reports.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Product requirements changed so some categories are optional for paid reports.
- The code at the cited lines no longer matches the excerpts.
- The fix requires changing the public report JSON contract beyond enforcing category coverage.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Future additions to `riskCategories` will automatically become mandatory in report validation. Reviewers should check that fixture reports and generator prompts are updated together whenever a new mandatory category is added.
