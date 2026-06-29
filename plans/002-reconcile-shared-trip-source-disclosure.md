# 002 - Reconcile Shared-Trip Source Disclosure

Status: ready  
Priority: P0  
Effort: medium  
Risk: medium  
Depends on: plan 001 recommended first  
Category: product contract and tests  
Planned at: `2026-06-30` against `e8b08d4`

## Goal

Resolve the conflicting shared-trip public contract around source freshness and `notChecked`
metadata, then update serialization, UI, tests, and docs so they all say the same thing.

Use the existing developer docs as the default contract: shared plans expose safe source
summaries, freshness timestamps, checked/not-checked arrays, and caveats, while continuing to
reject chat transcripts, geolocation, and raw provider payloads.

## Current Evidence

Five tests failed before this plan.

Server serialization strips `notChecked`:

- `src/server/trips/shared-trip-types.ts`
  - `publicSourceSummaryFromStored()` returns normalized sources with `notChecked: []`.

Docs say the public shared route should expose source summaries with checked and not-checked
arrays:

- `documentation/developer/reference/routes-and-surfaces.md`
  - shared plans expose selected saved artifacts, map links, source summaries, freshness
    timestamps, checked/not-checked arrays, and caveats.

Tests disagree:

- `src/server/trips/shared-trip-types.test.ts` expects original `notChecked` values to remain.
- `src/server/trips/shared-trip-store.test.ts` expects browser-saved not-reverified caveats.
- `src/app/trips/shared/[token]/page.test.tsx` expects freshness and not-checked text.
- `src/features/trips/SharedTripPlanPage.test.tsx` expects freshness and not-checked text not to
  render.

## Product Decision

Unless the product owner says otherwise during execution, implement this contract:

- Public shared trips may include source `checked`, `notChecked`, `fetchedAt`, and public
  caveats.
- Values must be source-governance metadata only, not raw provider payloads or chat content.
- Browser-saved trip sources should clearly say they were not reverified.
- The UI should show source metadata compactly enough to be useful without making the shared
  page feel like a debug dump.

## In Scope

- `src/server/trips/shared-trip-types.ts`
- `src/server/trips/shared-trip-types.test.ts`
- `src/server/trips/shared-trip-store.test.ts`
- `src/features/trips/SharedTripPlanPage.tsx`
- `src/features/trips/SharedTripPlanPage.test.tsx`
- `src/app/trips/shared/[token]/page.test.tsx`
- `documentation/developer/reference/routes-and-surfaces.md` if wording needs clarification.

## Out of Scope

- Exposing chat transcripts.
- Exposing raw Google Places, SerpAPI, or provider payloads.
- Changing token generation or shared-trip authorization.
- Adding paid trip passes, refresh budgets, or revenue-model behavior.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/002-shared-trip-source-disclosure
   ```

2. Inspect current source summary helpers and render paths:

   ```sh
   rg -n "publicSourceSummaryFromStored|notChecked|fetchedAt|browserSavedNotReverified" src/server/trips src/features/trips src/app/trips
   ```

3. Update server normalization:

   - preserve safe `checked` values;
   - preserve safe `notChecked` values instead of replacing them with `[]`;
   - preserve `fetchedAt` when present;
   - keep filtering/removal for raw payloads, internal ids, chat text, and location precision that
     should not be public.

4. If there is no sanitizer for public source checklist strings, add one close to the existing
   source-summary code. Keep it conservative:

   - trim whitespace;
   - drop empty entries;
   - cap very long strings;
   - do not allow objects or raw payload fields through.

5. Update shared page rendering:

   - render freshness in a compact source line, for example `Fetched 2026-...`;
   - render not-checked values as source-governance caveats, not as errors;
   - make browser-saved not-reverified status visible.

6. Reconcile tests to the selected contract:

   - server tests should assert `notChecked` survives public serialization when safe;
   - store tests should assert browser-saved sources include the not-reverified caveat;
   - page and feature tests should both expect the same visible behavior.

7. Update docs if the implementation uses more precise language than the current route reference.

## Verification

Run targeted tests:

```sh
bun test src/server/trips/shared-trip-types.test.ts src/server/trips/shared-trip-store.test.ts src/features/trips/SharedTripPlanPage.test.tsx 'src/app/trips/shared/[token]/page.test.tsx'
```

Then, after plan 001 is complete:

```sh
bun test
bun run lint
bun run typecheck --incremental false
```

Expected:

- the targeted shared-trip tests pass;
- full Bun suite passes when combined with plan 001;
- lint and typecheck pass.

## Done Criteria

- Serialization, UI, tests, and docs agree on source freshness and `notChecked`.
- Public shared trips still do not expose chat transcripts, geolocation, or raw provider payloads.
- Browser-saved trip sources communicate that they were not reverified.
- Verification commands pass.

## Stop Conditions

Stop and ask for a product decision if:

- the product owner wants `notChecked` hidden from public shared pages;
- source metadata now contains sensitive fields that cannot be safely sanitized;
- implementing this requires changing the shared token or persistence model.

## Suggested Commit

```text
Reconcile shared trip source disclosure
```
