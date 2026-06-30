# 009 - Consolidate Live Place Evidence Planning

Status: ready  
Priority: P1  
Effort: medium  
Risk: medium  
Depends on: plans 001 and 002 for a fully green final `bun test` run  
Category: correctness and product quality  
Planned at: `2026-06-30` against `ccdd368`

> Executor instructions: follow this plan step by step. Run each verification command before
> handing off. If a STOP condition occurs, stop and report instead of expanding scope.
>
> Drift check, run first:
>
> ```sh
> git diff --stat ccdd368..HEAD -- docs/ASK_SIARGAO_ROADMAP.md src/server/chat/place-intent.ts src/server/chat/required-evidence.ts src/server/chat/recommendation-agent.ts src/server/chat/place-intent.test.ts src/server/chat/ask-siargao-agent.test.ts src/server/chat/recommendation-agent.test.ts
> ```
>
> If any in-scope file changed since this plan was written, compare the current code to the
> excerpts below before editing.

## Goal

Make production live-place evidence planning match the richer place-intent behavior already present
in the repo. Activity-place prompts such as "covered places" and "beachfront places" should require
Google Places or fresh cached Places evidence, and service prompts should search for the specific
service requested rather than the generic query "services near ...".

## Why This Matters

The roadmap says travelers asking for restaurants, cafes, drinks, covered places, beachfront places,
specific places, nearby options, or open-now guidance should automatically get Google Places or
fresh cached Places evidence. The production required-evidence planner currently skips
`activity_place` and weakens `service` requests into generic searches. Meanwhile,
`RecommendationAgent` has tests for better service/activity inference, but that class is imported
only by its tests, not by the production ask-agent path.

## Current Evidence

`docs/ASK_SIARGAO_ROADMAP.md:46-50` states the product outcome:

```md
When a traveler asks for restaurants, cafes, drinks, covered places, beachfront places, specific
places, nearby options, or open-now guidance, Ask Siargao should automatically use Google Places or
fresh cached Places rows and avoid generic local-place prose.
```

`src/server/chat/place-intent.ts:10-16` includes `activity_place` and `service` categories:

```ts
export type PlaceCategory =
  | "food"
  | "coffee"
  | "bar"
  | "activity_place"
  | "service"
  | "specific_place";
```

`src/server/chat/place-intent.ts:139-141` classifies covered/beachfront place prompts as
`activity_place`, and `src/server/chat/place-intent.test.ts:34-45` already tests "beachfront places
near General Luna".

`src/server/chat/required-evidence.ts:140-148` currently excludes `activity_place`:

```ts
function requiresPlacesEvidence(placeIntent: PlaceIntentSignal) {
  return (
    placeIntent.category === "food" ||
    placeIntent.category === "coffee" ||
    placeIntent.category === "bar" ||
    placeIntent.category === "specific_place" ||
    placeIntent.category === "service"
  );
}
```

`src/server/chat/required-evidence.ts:200-202` creates a generic service query:

```ts
if (placeIntent.category === "service") {
  return `services near ${location} Siargao`;
}
```

`src/server/chat/recommendation-agent.ts:676-699` has better local inference for services and
activity places:

```ts
if (intent.category === "service") {
  return inferServiceSearchTerm(primaryIntentText);
}
...
if (intent.category === "activity_place") {
  if (/\bbeachfront\b/i.test(primaryIntentText)) {
    return "beachfront places";
  }
  if (/\bcovered|indoors?|inside\b/i.test(primaryIntentText)) {
    return "covered places";
  }
  return "places to go";
}
```

`src/server/chat/recommendation-agent.ts:739-778` maps pharmacy, clinic, ATM, laundry, scooter
rental, cafe, bar, and restaurant terms to specific search terms and included types where supported.

`rg -n "RecommendationAgent|new RecommendationAgent|recommendation-agent" src -g '*.ts'` shows
`RecommendationAgent` is imported only by `src/server/chat/recommendation-agent.test.ts`, so its
coverage does not protect the production ask-agent path.

## Commands You Will Need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Search | `rg -n "requiresPlacesEvidence|placesSearchQuery|inferServiceSearchTerm|inferIncludedType|activity_place" src/server/chat` | Shows current call sites |
| Place-intent tests | `bun test src/server/chat/place-intent.test.ts` | All tests pass |
| Ask-agent tests | `bun test src/server/chat/ask-siargao-agent.test.ts` | All tests pass |
| Recommendation tests | `bun test src/server/chat/recommendation-agent.test.ts` | All tests pass |
| Lint | `bun run lint` | Exit 0 |
| Typecheck | `bun run typecheck --incremental false` | Exit 0, no errors |
| Full unit baseline | `bun test` | Exit 0 after plans 001 and 002 land |

## Scope

In scope:

- `src/server/chat/required-evidence.ts`
- `src/server/chat/place-intent.ts` only if the shared helper belongs there
- `src/server/chat/recommendation-agent.ts` only to reuse the shared helper or remove duplicate
  inference
- `src/server/chat/place-intent.test.ts`
- `src/server/chat/ask-siargao-agent.test.ts`
- `src/server/chat/recommendation-agent.test.ts`

Out of scope:

- Replacing the production ask-agent with `RecommendationAgent`.
- Building nightlife event evidence; plan 007 covers that larger direction.
- Changing Google Places adapters, cache persistence, or field masks.
- Adding new database schema.
- Broad refactors of intent classification.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/009-place-evidence-planner
   ```

2. Add a small shared helper for place search planning.

   Prefer a new module such as `src/server/chat/place-search-plan.ts` if that keeps
   `place-intent.ts` focused on classification. Export a function with a narrow input that both
   `required-evidence.ts` and `recommendation-agent.ts` can use, for example:

   ```ts
   export type PlaceSearchPlanInput = {
     category?: string;
     meal?: string | null;
     location?: string | null;
     areaScope?: string | null;
     latestUserTurn?: string;
     recentUserContext?: string;
     constraints?: readonly unknown[];
   };

   export type PlaceSearchPlan = {
     query: string;
     includedType: string | null;
   };
   ```

   The helper should preserve existing food/coffee/bar behavior and add:

   - `activity_place` plus `beachfront` -> query `beachfront places near|in <location> Siargao`;
   - `activity_place` plus `covered`, `indoor`, `inside` -> query `covered places near|in <location> Siargao`;
   - `service` plus pharmacy/drugstore -> query `pharmacy near|in <location> Siargao`, included type `pharmacy`;
   - `service` plus clinic -> query `clinic near|in <location> Siargao`, included type `null` unless Google Places supported type usage is already proven in this repo;
   - `service` plus ATM/cash machine -> query `atm near|in <location> Siargao`, included type `atm`;
   - `service` plus laundry -> query `laundry near|in <location> Siargao`, included type `laundry`;
   - `service` plus scooter/motorbike rental -> query `scooter rental near|in <location> Siargao`, included type `null`;
   - service fallback -> `local service near|in <location> Siargao`, included type `null`.

   Use the existing `areaScope === "nearby"` convention from
   `recommendation-agent.ts:647-655`: nearby uses `near <location>`, otherwise use
   `in <location>`.

   Verify:

   ```sh
   bun run typecheck --incremental false
   ```

   Expected: exit 0 or type errors only at the callers being updated next.

3. Update `src/server/chat/required-evidence.ts`.

   - Include `activity_place` in `requiresPlacesEvidence()`.
   - Replace `includedTypeForPlaceCategory()` and `placesSearchQuery()` internals with the shared
     helper.
   - Preserve existing `requiresOpenNowEvidence()` behavior: dinner still requires open-now
     evidence; explicit open/hours terms still require open-now/hours evidence.
   - Keep `acceptedSourceLabels: ["live_checked", "fresh_cache"]` and `allowedCardKinds: ["place"]`.

   Verify:

   ```sh
   bun run typecheck --incremental false
   ```

   Expected: exit 0.

4. Update `RecommendationAgent` to use the shared helper or keep it behaviorally aligned.

   The lowest-risk option is to have `inferPlaceSearchTerm()` and `inferIncludedType()` delegate to
   the shared helper, while keeping the rest of `RecommendationAgent` unchanged. Its existing tests
   for pharmacies and covered cafes should continue to pass.

   Verify:

   ```sh
   bun test src/server/chat/recommendation-agent.test.ts
   ```

   Expected: all tests pass.

5. Add production-path regression tests in `src/server/chat/ask-siargao-agent.test.ts`.

   Model them after the existing required-evidence test around lines 481-526. Add scenarios for:

   - `placeIntent.category: "activity_place"`, prompt "beachfront places near General Luna",
     expected automatic `search_places` arguments include a query containing `beachfront places`
     and source/card selection requires a place card.
   - `placeIntent.category: "service"`, prompt "Any pharmacy nearby that is open now?",
     expected automatic `search_places` arguments include query `pharmacy near General Luna Siargao`,
     constraints include `included_type: "pharmacy"` and `open_now: true`.
   - `placeIntent.category: "service"`, prompt "Nearest ATM to Dapa ferry terminal?",
     expected query narrows to `atm` and does not use the generic `services near`.

   Verify:

   ```sh
   bun test src/server/chat/ask-siargao-agent.test.ts
   ```

   Expected: new tests fail before the implementation and pass after it.

6. Add focused helper tests if the helper has enough branching.

   If you create `src/server/chat/place-search-plan.ts`, add
   `src/server/chat/place-search-plan.test.ts`. Cover at least:

   - existing dinner query still returns `restaurants and dinner spots in General Luna, Siargao`
     or update the expected string consistently across existing tests;
   - covered/beachfront activity-place queries;
   - pharmacy, ATM, laundry, clinic, scooter rental service terms;
   - unknown service fallback.

   Verify:

   ```sh
   bun test src/server/chat/place-search-plan.test.ts
   ```

   Expected: all helper tests pass.

## Test Plan

- Existing `place-intent.test.ts` remains the classification layer.
- New or updated helper tests cover query and included-type inference.
- `ask-siargao-agent.test.ts` proves the production required-evidence path automatically calls
  `search_places` for activity-place and specific service prompts.
- Existing `recommendation-agent.test.ts` proves the legacy helper behavior did not regress.

## Done Criteria

- `activity_place` prompts require successful Places evidence before final place-card answers.
- Service prompts no longer use the generic `services near <location> Siargao` query when the user
  asks for pharmacy, clinic, ATM, laundry, or scooter rental.
- Food, coffee, bar, dinner, nearby, and specific-place tests still pass.
- Targeted tests, lint, and typecheck pass.
- `bun test` passes after plans 001 and 002 restore the known baseline.
- `plans/README.md` status row is updated.

## STOP Conditions

Stop and report if:

- Google Places rejects an included type that this plan suggested. Keep the narrow query, omit the
  unsupported `included_type`, and document the reason.
- The helper change starts rewriting final answer text or card rendering outside required evidence.
- A full fix requires replacing the production ask-agent planner or deleting `RecommendationAgent`.
- The roadmap has been changed to remove covered/beachfront/service live evidence as a product
  requirement.

## Maintenance Notes

Keep place-intent classification and place-search planning separate. Future categories such as
nightlife events should not overload this helper; use plan 007's event evidence path instead.

Suggested commit:

```text
Consolidate place evidence planning
```
