# 005 - Extract Saved-Trip Client State From ChatWorkspace

Status: ready  
Priority: P2  
Effort: large  
Risk: medium  
Depends on: plans 001 and 002 recommended first  
Category: maintainability  
Planned at: `2026-06-30` against `e8b08d4`

## Goal

Move saved-trip client storage, API calls, and item-building helpers out of
`src/features/chat/ChatWorkspace.tsx` into a focused module with tests, without changing user
behavior.

`ChatWorkspace.tsx` is large enough that unrelated chat UI changes must currently reason through
saved-trip persistence, localStorage synchronization, sharing, and route calls in the same file.

## Current Evidence

The saved-trip client logic is embedded near the bottom of `ChatWorkspace.tsx`, including:

- id creation;
- `/api/trips` API calls;
- localStorage read/write and subscriber state;
- conversion from chat cards and itinerary cards into saved-trip items;
- saved trip share request logic.

The file is roughly 3.5K lines, making behavioral changes and reviews harder than necessary.

## In Scope

- `src/features/chat/ChatWorkspace.tsx`
- New module such as `src/features/chat/saved-trip-client.ts`
- New tests such as `src/features/chat/saved-trip-client.test.ts`
- Minimal type exports needed by `ChatWorkspace.tsx`

## Out of Scope

- Redesigning saved trips UX.
- Changing `/api/trips` route contracts.
- Changing shared-trip public page behavior.
- Reworking chat streaming, provider selection, or itinerary generation.

## Target Design

Create a focused saved-trip client module that owns:

- saved-trip state shape and empty-state factory;
- localStorage serialization and deserialization;
- subscription/snapshot helpers used by React;
- API functions for list, save, delete, and share;
- pure item builders for saved chat recommendation cards and itinerary cards.

Keep React rendering and event wiring in `ChatWorkspace.tsx`.

Prefer injecting browser dependencies into pure helpers where practical:

```ts
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type FetchLike = typeof fetch;
```

This makes unit tests possible without relying on a full browser environment.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/005-extract-saved-trip-client
   ```

2. Make sure plans 001 and 002 are already merged or locally applied, then confirm the baseline:

   ```sh
   bun test src/app/api/trips/route.test.ts src/server/trips/shared-trip-types.test.ts src/server/trips/shared-trip-store.test.ts
   ```

3. Inspect saved-trip code in `ChatWorkspace.tsx`:

   ```sh
   rg -n "SavedTrip|savedTrip|localStorage|/api/trips|share" src/features/chat/ChatWorkspace.tsx
   ```

4. Extract pure types and helpers first:

   - saved-trip local state type;
   - empty state factory;
   - localStorage key and parse/serialize helpers;
   - item builders from recommendation/itinerary data.

5. Add focused unit tests for the new module:

   - malformed localStorage data falls back to empty state;
   - valid localStorage data round-trips;
   - saved recommendation card builder keeps required fields and source metadata;
   - itinerary builder keeps route/map/source fields expected by `/api/trips`;
   - API helpers call the expected method/path and handle non-OK responses.

6. Move browser-facing helpers:

   - snapshot/subscription functions;
   - `fetch` wrappers for save/delete/share;
   - storage write notification.

7. Update `ChatWorkspace.tsx` imports and remove the moved code.

   The component should still own:

   - hook calls;
   - UI state transitions;
   - toast/error presentation;
   - event handlers that compose imported helpers.

8. Keep the public UI unchanged. Avoid renaming labels, buttons, or data-testid attributes unless
   tests require it.

## Verification

Run:

```sh
bun test src/features/chat/saved-trip-client.test.ts
bun test src/app/api/trips/route.test.ts
bun run lint
bun run typecheck --incremental false
bun run build
```

If the change touches visible saved-trip behavior, also run:

```sh
bun run test:e2e
```

Expected:

- new focused unit tests pass;
- existing route tests pass;
- lint, typecheck, and build pass;
- e2e passes if run.

## Done Criteria

- Saved-trip storage/API/item-builder logic lives outside `ChatWorkspace.tsx`.
- `ChatWorkspace.tsx` is smaller and imports saved-trip helpers instead of defining them inline.
- Extracted helpers have focused unit coverage.
- User-visible saved-trip behavior is unchanged.
- Verification commands pass.

## Stop Conditions

Stop and update this plan if:

- the extraction reveals saved-trip behavior is coupled to streaming state in a way that requires a
  product-visible rewrite;
- existing tests are still failing from plans 001 or 002;
- the new module would need to own React rendering or UI state to compile.

## Suggested Commit

```text
Extract saved trip client state
```
