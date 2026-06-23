# Plan 005: Keep retrieval evidence IDs scoped to selected facts

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/llm/retrieval-tools.ts src/server/audit/evidence-bundles.ts src/server/llm/report-generation.test.ts src/server/audit/risk-report.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The audit product promises that important claims cite supporting evidence. Today the controlled retrieval tool can return evidence IDs unrelated to the facts selected by that tool because the evidence bundle drops the `factId` mapping. A generated report can cite an unrelated evidence ID and still pass validation because the ID exists somewhere in the bundle.

## Current State

- `src/server/audit/evidence-bundles.ts` converts governed evidence to public `EvidenceReference` objects.
- `src/server/llm/retrieval-tools.ts` maps selected facts to evidence IDs.
- `src/server/llm/report-generation.test.ts` has fixtures with route and accommodation facts/evidence.

Relevant excerpts:

```ts
// src/server/audit/evidence-bundles.ts:44
references.push({
  evidenceId: item.id,
  label: item.label,
```

```ts
// src/server/llm/retrieval-tools.ts:139
function evidenceIdsForFacts(context: RetrievalContext, facts: readonly GovernedFact[]) {
  const factIds = new Set(facts.map((fact) => fact.id));

  return context.evidenceBundle.evidence
    .filter((evidence) => context.evidenceBundle.factIds.some((factId) => factIds.has(factId)))
```

```ts
// src/server/llm/report-generation.test.ts:80
const evidence: GovernedEvidence[] = [
  {
    id: "ev_route",
    factId: "fact_route",
```

Repo conventions:

- Report validation already checks that evidence IDs exist in a bundle.
- Tests use fixture facts and evidence arrays with explicit IDs.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/llm/report-generation.test.ts src/server/audit/risk-report.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/audit/evidence-bundles.ts`
- `src/server/llm/retrieval-tools.ts`
- `src/server/llm/report-generation.test.ts`
- `src/server/audit/risk-report.test.ts`
- `src/server/audit/report-validation.ts` only if validation needs the evidence-to-fact mapping

**Out of scope**:

- Changing the public `EvidenceReference` schema unless necessary.
- Rewriting LLM prompts.
- Changing risk ranking or report structure.
- Provider/source policy changes.

## Git Workflow

- Branch: `advisor/005-scope-retrieval-evidence`
- Commit message style: `fix: scope retrieval evidence to selected facts`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Preserve evidence-to-fact mapping in the bundle

Extend `EvidenceBundle` with a non-user-facing mapping such as:

```ts
evidenceFactIds: Record<string, string>
```

or make `EvidenceBundle.evidence` carry `factId` internally. Prefer not to expose `factId` through `EvidenceReference` if that type is intended for report output.

Populate the mapping in `createEvidenceBundle` from each `GovernedEvidence.factId`.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 2: Fix `evidenceIdsForFacts`

Update `evidenceIdsForFacts` so it returns only evidence IDs whose mapped `factId` is in the selected facts set.

Expected behavior:

- `route_risks` returns route evidence, not accommodation evidence.
- `area_profile` returns area/accommodation evidence, not route-only evidence.
- `source_credibility` may still return broader bundle evidence only if that is intentionally documented and tested.

**Verify**: `bun test src/server/llm/report-generation.test.ts` -> exit 0 after tests are added.

### Step 3: Add regression tests

In `src/server/llm/report-generation.test.ts`, add a test with the existing `fact_route`, `fact_accommodation`, `ev_route`, and `ev_accommodation` fixtures:

- call `route_risks`
- assert `evidenceIds` equals only `["ev_route"]`
- call `area_profile` or `accommodation_facts`
- assert route evidence is not returned unless the selected fact type includes it

If report validation is adjusted, add a validation test proving a route risk cannot cite accommodation-only evidence.

**Verify**: `bun test src/server/llm/report-generation.test.ts src/server/audit/risk-report.test.ts` -> exit 0.

### Step 4: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Use the existing route/accommodation fixture split in `src/server/llm/report-generation.test.ts`. Add focused assertions on `AuditToolCallRecord.evidenceIds`, because that is the bug surface.

## Done Criteria

- [ ] `EvidenceBundle` preserves a fact-to-evidence mapping.
- [ ] Retrieval tools return evidence IDs only for their selected facts.
- [ ] Regression tests prove route retrieval cannot return accommodation evidence.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Fixing the bug requires a public API shape change that would affect rendered report JSON.
- The code has drifted so the bundle no longer drops `factId`.
- The validation model needs a larger redesign than evidence-to-fact mapping.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Any future retrieval tool must preserve the invariant: a model can only cite evidence IDs returned by the tool for the facts that tool returned.

