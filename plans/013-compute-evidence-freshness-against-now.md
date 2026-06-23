# Plan 013: Compute evidence freshness against the current time

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/audit/evidence-bundles.ts src/server/audit/risk-report.test.ts src/server/llm/report-generation.test.ts src/server/audit/schemas.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/005-scope-retrieval-evidence.md`
- **Category**: bug
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

Evidence freshness is shown in report output and fed into LLM/reviewer context. The current bundle builder labels any fact with an `expiresAt` value as `fresh`, even if that timestamp is already in the past. That can make stale route, weather, policy, or accommodation evidence appear fresh to users and model checks.

This plan depends on plan 005 because both touch `src/server/audit/evidence-bundles.ts`; execute 005 first to avoid conflicting bundle-shape changes.

## Current State

- `src/server/audit/evidence-bundles.ts` converts governed evidence/facts into report-facing `EvidenceReference` objects.
- `src/server/audit/schemas.ts` allows freshness values `"fresh"`, `"stale"`, and `"unknown"`.
- `src/server/audit/risk-report.test.ts` already has stale fact validation tests, but not evidence-label tests.

Relevant excerpts:

```ts
// src/server/audit/schemas.ts:17
freshness: z.enum(["fresh", "stale", "unknown"]),
```

```ts
// src/server/audit/evidence-bundles.ts:49
fetchedAt:
  facts.find((fact) => fact.id === item.factId)?.fetchedAt ?? new Date(0).toISOString(),
confidence: facts.find((fact) => fact.id === item.factId)?.confidenceLabel ?? "low",
freshness: facts.find((fact) => fact.id === item.factId)?.expiresAt ? "fresh" : "unknown",
```

```ts
// src/server/audit/risk-report.test.ts:219
test("fails on stale critical facts", () => {
  const staleFact = { ...baseFact, expiresAt: "2026-06-20T00:00:00.000Z" };
```

Repo conventions:

- Tests use deterministic dates such as `2026-06-23T00:00:00.000Z`.
- Report validation already treats `expiresAt < now` as stale in `src/server/audit/report-validation.ts`.
- Avoid changing public `EvidenceReference` shape unless plan 005 already did so.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/audit/risk-report.test.ts src/server/llm/report-generation.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/audit/evidence-bundles.ts`
- `src/server/audit/risk-report.test.ts`
- `src/server/llm/report-generation.test.ts` only if fixture calls need the new clock parameter

**Out of scope**:

- Changing `EvidenceReference` public shape.
- Changing report UI copy.
- Changing source freshness-window policy.
- Reworking critical-fact validation in `report-validation.ts`.
- Evidence-to-fact scoping; that is plan 005.

## Git Workflow

- Branch: `advisor/013-compute-evidence-freshness`
- Commit message style: `fix: compute evidence freshness from expiry`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add deterministic bundle freshness tests

In `src/server/audit/risk-report.test.ts`, add focused tests for `createEvidenceBundle`:

- a fact with `expiresAt` after `now` produces `fresh`
- a fact with `expiresAt` before `now` produces `stale`
- a fact with no `expiresAt` produces `unknown`

If the file becomes too crowded, create `src/server/audit/evidence-bundles.test.ts`, but prefer the existing audit test file unless there is a clear reason to split.

**Verify**: `bun test src/server/audit/risk-report.test.ts` -> fails for stale freshness until implementation is added.

### Step 2: Add a clock input to evidence bundle creation

Update `createEvidenceBundle` to accept an optional `now?: Date` parameter, defaulting to `new Date()` for production callers.

Recommended shape:

```ts
export function createEvidenceBundle({
  evidence,
  facts,
  id,
  now = new Date(),
  visibility,
}: {
  id: string;
  now?: Date;
  visibility: EvidenceBundleVisibility;
  facts: readonly GovernedFact[];
  evidence: readonly GovernedEvidence[];
}): EvidenceBundle {
```

Build a `factsById` map instead of repeatedly calling `facts.find(...)`. This will also make the freshness helper straightforward.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 3: Compute freshness from `expiresAt`

Add a small helper in `src/server/audit/evidence-bundles.ts`:

```ts
function evidenceFreshness(fact: GovernedFact | undefined, now: Date) {
  if (!fact?.expiresAt) {
    return "unknown" as const;
  }

  return new Date(fact.expiresAt).getTime() < now.getTime() ? "stale" : "fresh";
}
```

Use this helper when creating each `EvidenceReference`.

Do not treat parse failures as fresh. If `expiresAt` is invalid, either return `"unknown"` or throw an `EvidenceBundleError`; prefer `"unknown"` if existing data can be imperfect, and add a test for that behavior if implemented.

**Verify**: `bun test src/server/audit/risk-report.test.ts` -> exit 0.

### Step 4: Update callers only if needed

Most callers can rely on the default `now`. Test fixtures that assert deterministic freshness should pass `now` explicitly.

If plan 005 has added an evidence-to-fact mapping to `EvidenceBundle`, preserve that mapping and add freshness without removing it.

**Verify**:

- `bun test src/server/audit/risk-report.test.ts src/server/llm/report-generation.test.ts` -> exit 0
- `bun run typecheck --incremental false` -> exit 0

### Step 5: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Add tests around `createEvidenceBundle` that prove:

- future `expiresAt` means `fresh`
- past `expiresAt` means `stale`
- missing `expiresAt` means `unknown`

Use deterministic `now = new Date("2026-06-23T00:00:00.000Z")` as in existing audit tests.

## Done Criteria

- [ ] Evidence references no longer label expired facts as fresh.
- [ ] `createEvidenceBundle` supports deterministic freshness tests through an injected `now`.
- [ ] Tests cover fresh, stale, and unknown evidence labels.
- [ ] Plan 005's evidence-to-fact mapping, if already implemented, is preserved.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Plan 005 has changed the bundle structure so the current excerpts no longer match.
- Fixing freshness requires changing the public `EvidenceReference` schema.
- Source freshness windows need a product/legal decision not represented in code.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Any future evidence builder or provider ingestion path should pass a deterministic clock in tests. Reviewers should check that displayed freshness and deterministic report validation agree about stale facts.
