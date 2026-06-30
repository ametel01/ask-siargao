# 002 - Align Shared-Trip Source Disclosure Docs With The Public Contract

Status: done
Priority: P2
Effort: small
Risk: low
Depends on: none
Category: docs and product contract
Planned at: `2026-06-30` against `a9d1775`
Completed at: `2026-06-30`

## Authoritative Contract

Issue #8 and PR #9 are authoritative for shared-trip source disclosure. The current public
shared-trip contract intentionally preserves and renders governed traveler-safe `notChecked` source
context while keeping private/internal data hidden.

This plan was originally written from stale evidence that treated public `notChecked` source
details as hidden. That direction is superseded by the maintainer decision on issue #23 and by the
merged issue #8 / PR #9 behavior. Future builders should not use this plan to remove public
`notChecked` rows unless a new product issue explicitly changes the contract.

## Current Behavior

Public shared plans expose only selected saved artifacts and public-safe display fields:

- safe map links;
- sanitized source summaries and source labels;
- confidence and freshness metadata;
- checked-source details;
- governed traveler-safe `notChecked` source context;
- public display caveats.

Public shared plans keep private/internal data out of the shared DTO and rendered page:

- full chat messages or transcripts;
- owner IDs, profile data, and secret tokens;
- client geolocation and exact coordinates;
- raw tool calls or arguments;
- raw provider payloads;
- private source observations;
- Google review fields, review text, or author data;
- internal verification-gap caveats on saved cards, itinerary stops, and skip notes.

Public `notChecked` source context is not the same as an internal verification-gap caveat. Source
`notChecked` rows describe traveler-safe source coverage limits, for example "Not checked by
Open-Meteo weather API: surf reports." Internal caveats that reveal implementation gaps or private
capture context remain filtered from public cards, itinerary stops, and skip notes.

## Evidence

The current implementation and tests already encode the #8/#9 contract:

- `src/server/trips/shared-trip-types.ts` normalizes public source summaries without stripping
  `notChecked` and appends the public browser-saved not-reverified source when needed.
- `src/features/trips/SharedTripPlanPage.tsx` renders public source context from both `checked` and
  `notChecked` rows while filtering internal verification-gap caveats from displayed notes.
- `src/server/trips/shared-trip-types.test.ts`,
  `src/server/trips/shared-trip-store.test.ts`,
  `src/features/trips/SharedTripPlanPage.test.tsx`, and
  `src/app/trips/shared/[token]/page.test.tsx` cover public shared-trip serialization and rendering
  boundaries.

## Verification Commands

```sh
git diff --stat a9d1775..HEAD -- src/server/trips/shared-trip-types.ts src/server/trips/shared-trip-types.test.ts src/server/trips/shared-trip-store.test.ts src/features/trips/SharedTripPlanPage.tsx src/features/trips/SharedTripPlanPage.test.tsx 'src/app/trips/shared/[token]/page.test.tsx' documentation/developer/reference/routes-and-surfaces.md
rg -n "checked/not-checked|notChecked|Not checked" documentation src/server/trips src/features/trips 'src/app/trips/shared/[token]/page.test.tsx'
bun test src/server/trips/shared-trip-types.test.ts src/server/trips/shared-trip-store.test.ts src/features/trips/SharedTripPlanPage.test.tsx 'src/app/trips/shared/[token]/page.test.tsx'
bun run lint
bun run typecheck --incremental false
bun test
git diff --check
```

Database migrate/seed and e2e gates are unnecessary for this completed implementation because the
final diff is documentation/plan-only and does not change schema, persistence behavior, route
handlers, browser selectors, or rendered shared-trip behavior.

## Done Criteria

- The route/surface reference describes governed traveler-safe public `notChecked` source context.
- The route/surface reference distinguishes public source `notChecked` rows from private/internal
  verification-gap caveats.
- This plan records preservation of public `notChecked` source context and names issue #8 / PR #9
  as authoritative.
- `plans/README.md` marks plan 002 done.
