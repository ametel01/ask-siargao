# 002 - Align Shared-Trip Source Disclosure Docs With The Public Contract

Status: ready
Priority: P2
Effort: small
Risk: low
Depends on: none
Category: docs and product contract
Planned at: `2026-06-30` against `a9d1775`

> Executor instructions: follow this plan step by step. Run each verification command before
> handing off. If a STOP condition occurs, stop and report instead of expanding scope.
>
> Drift check, run first:
>
> ```sh
> git diff --stat a9d1775..HEAD -- src/server/trips/shared-trip-types.ts src/server/trips/shared-trip-types.test.ts src/server/trips/shared-trip-store.test.ts src/features/trips/SharedTripPlanPage.tsx src/features/trips/SharedTripPlanPage.test.tsx 'src/app/trips/shared/[token]/page.test.tsx' documentation/developer/reference/routes-and-surfaces.md
> ```
>
> If any in-scope file changed since this plan was written, compare the current code to the
> excerpts below before editing.

## Goal

Make the developer route documentation match the current public shared-trip source contract.
At `a9d1775`, public shared trips intentionally preserve safe checked source labels and freshness
signals, but strip `notChecked` details from the public payload and UI. The docs still say public
shared plans expose checked/not-checked arrays, so future agents may reintroduce the older behavior.

This plan is a documentation and contract-alignment task. It does not reopen the product decision
unless the maintainer explicitly wants public shared pages to show `notChecked` caveats.

## Current Evidence

`src/server/trips/shared-trip-types.ts` normalizes public sources and strips `notChecked`:

```ts
function publicSourceSummaryFromStored(source: AnswerSourceSummary) {
  return {
    ...normalizeSourceSummary(source),
    notChecked: [],
  };
}
```

`src/features/trips/SharedTripPlanPage.tsx` only renders actually checked public sources:

```ts
function SourceSummaryList({ sources }: { sources: SharedTripPlan["items"][number]["sources"] }) {
  const visibleSources = sources.filter(isActuallyCheckedSource);
  if (visibleSources.length === 0) {
    return null;
  }
```

Current tests encode this hidden-`notChecked` contract:

- `src/server/trips/shared-trip-types.test.ts` expects public sources such as
  `{ ...placesSource, notChecked: [] }`.
- `src/server/trips/shared-trip-store.test.ts` expects shared-plan snapshots to return sources
  with empty `notChecked` arrays.
- `src/features/trips/SharedTripPlanPage.test.tsx` expects not-checked caveats such as
  `Not checked by Open-Meteo weather API: surf reports` not to render.

The route reference is stale:

```md
Shared plans expose selected saved artifacts, map links, source summaries, freshness
timestamps, checked/not-checked arrays, and caveats.
```

## Commands You Will Need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Search contract text | `rg -n "checked/not-checked|notChecked|Not checked" documentation src/server/trips src/features/trips 'src/app/trips/shared/[token]/page.test.tsx'` | Shows only intentional references |
| Shared-trip tests | `bun test src/server/trips/shared-trip-types.test.ts src/server/trips/shared-trip-store.test.ts src/features/trips/SharedTripPlanPage.test.tsx 'src/app/trips/shared/[token]/page.test.tsx'` | All pass |
| Lint | `bun run lint` | Exit 0 |
| Typecheck | `bun run typecheck --incremental false` | Exit 0, no errors |
| Full unit baseline | `bun test` | Exit 0 |

## Scope

In scope:

- `documentation/developer/reference/routes-and-surfaces.md`
- Shared-trip tests only if the docs need a clearer regression assertion.
- `src/server/trips/shared-trip-types.ts` only for comments or naming that clarify the existing
  public contract.

Out of scope:

- Exposing `notChecked` caveats publicly.
- Changing token generation, shared-trip authorization, or persistence.
- Exposing chat transcripts, geolocation, raw provider payloads, or raw source observations.
- Adding paid trip passes, refresh budgets, or revenue-model behavior.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/002-shared-trip-source-contract-docs
   ```

2. Inspect the current implementation and tests:

   ```sh
   rg -n "publicSourceSummaryFromStored|isActuallyCheckedSource|notChecked|checked/not-checked" src/server/trips src/features/trips 'src/app/trips/shared/[token]/page.test.tsx' documentation/developer/reference/routes-and-surfaces.md
   ```

3. Update `documentation/developer/reference/routes-and-surfaces.md`.

   Replace wording that says public shared plans expose `checked/not-checked arrays` with the
   current contract:

   - public shared plans expose selected saved artifacts, safe map links, sanitized source
     summaries, source labels, confidence/freshness metadata, checked-source details, and public
     display caveats;
   - public shared plans strip not-checked details from persisted source summaries before sharing;
   - public shared plans reject full chat messages, coordinates, raw tool calls, and raw provider
     payloads.

4. If the existing tests do not make the contract obvious after reading them, add one focused
   assertion to `src/server/trips/shared-trip-types.test.ts`:

   - a stored source with `notChecked: ["table availability"]` becomes public with
     `notChecked: []`;
   - checked source details and `fetchedAt` still survive public serialization.

   Do not change UI behavior in this plan.

5. Run the targeted shared-trip tests.

   ```sh
   bun test src/server/trips/shared-trip-types.test.ts src/server/trips/shared-trip-store.test.ts src/features/trips/SharedTripPlanPage.test.tsx 'src/app/trips/shared/[token]/page.test.tsx'
   ```

   Expected: all pass.

6. Run broad checks.

   ```sh
   bun run lint
   bun run typecheck --incremental false
   bun test
   ```

   Expected: all pass.

## Test Plan

- Prefer existing shared-trip serialization and page tests. Add only a narrow regression assertion
  if the current hidden-`notChecked` behavior is not already explicit enough.
- Do not add e2e coverage for this documentation-only correction unless visible UI behavior changes.

## Done Criteria

- `documentation/developer/reference/routes-and-surfaces.md` no longer claims that public shared
  plans expose not-checked arrays.
- The docs explicitly say not-checked source details are stripped from public shared plans.
- Existing shared-trip tests still pass.
- `bun run lint`, `bun run typecheck --incremental false`, and `bun test` pass.
- `plans/README.md` status row is updated.

## STOP Conditions

Stop and report if:

- The maintainer wants public shared pages to show not-checked caveats after all. That is a product
  behavior change and needs a different plan.
- The implementation has drifted and now preserves public `notChecked` values intentionally.
- Updating the docs reveals another public contract conflict outside shared-trip source metadata.

## Maintenance Notes

Future work can still choose to expose selected not-checked caveats publicly, but that should be a
deliberate product change with serialization, UI, and tests updated together. Until then, keep
shared-trip public payloads conservative: checked facts and freshness can be visible; unverified
details and private capture context stay out.

Suggested commit:

```text
Document shared trip source contract
```
