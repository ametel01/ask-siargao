# Implementation Plan

## Source Documents
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
  - Role: Primary roadmap and feature specification.
  - Summary: Priority 11 requires travelers to save restaurants, beaches, and itineraries
    from chat, share compact trip plans without exposing full chat history, preserve source
    caveats and freshness labels, start with local browser storage when trip persistence is
    absent, and move saved items to Postgres with share-token access when persistence exists.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
  - Role: Architecture constraints.
  - Summary: Chat answers must remain AI-written; deterministic backend code may execute tools,
    enforce policy, validate source consistency, and render non-chat artifacts such as saved
    shared plans. Shared-plan work must preserve source governance and avoid leaking raw or
    restricted provider data.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`
  - Role: Product positioning and UX constraints.
  - Summary: Ask Siargao should win through practical, current, Siargao-specific decisions with
    maps links, source freshness, caveats, and trust labels. Save and share trip plans is the
    retention/collaboration layer after cards and itineraries.

## Goals
- Let travelers save recommendation cards and itinerary artifacts from chat.
- Let travelers remove saved items and see a compact saved-plan tray during the chat session.
- Let travelers create a share token for selected saved items once server persistence is added.
- Render a public shared plan page that shows only selected items, maps links, source freshness,
  and caveats.
- Prevent shared plans from exposing unrelated chat history, exact browser geolocation, raw
  restricted provider payloads, or source metadata that policy does not allow.
- Keep the implementation aligned with the existing Bun, Next.js App Router, Drizzle, PGlite,
  Bun test, Biome, and Playwright patterns.

## Non-Goals
- Building authenticated user accounts or a full trip/pass product.
- Turning Ask Siargao into a generic multi-destination trip planner.
- Persisting full chat transcripts as part of the shared plan.
- Adding collaboration editing, comments, real-time presence, or invite permissions.
- Republishing Google review text, raw provider payloads, or any field disallowed by source
  governance.
- Changing the AI agent contract for chat responses; the chat answer remains model-written.

## Assumptions and Open Questions
- Assumption: Because no durable trip/pass persistence table exists yet, the first visible slice
  should use browser `localStorage` for unauthenticated saved items, then add minimal anonymous
  server persistence for share-token creation.
  - Impact: Users can save locally before sharing exists, and the server model can stay narrowly
    scoped to selected share artifacts.
- Assumption: A generated anonymous `tripId` stored in browser `localStorage` is sufficient for
  the initial server-backed share flow.
  - Impact: Saved plans survive browser refresh on the same device but are not account-portable.
- Assumption: Shared links can be public, unguessable token URLs with optional expiration, without
  requiring login.
  - Impact: Access control focuses on token entropy, expiry, deletion/revocation, and policy-safe
    payload projection.
- Assumption: Recommendation card artifacts and itinerary artifacts are the canonical saveable
  payloads for the first release. Free-form `note` items can be represented in shared types but
  may be deferred unless it is needed for UI completeness.
  - Impact: The implementation stays tied to existing chat output shapes.
- Open question: Should shared tokens expire by default?
  - Conservative plan: Support `expiresAt` in schema and route behavior, default to no expiry in
    the first UI unless product copy specifies a default.
- Open question: Should share creation require server-side revalidation of stale provider
  freshness?
  - Conservative plan: Preserve the captured freshness labels and caveats, and block restricted
    fields; do not perform live refresh during share creation unless later requested.

## Quality Gates
- Setup status: Existing gates are configured in `package.json`, `biome.json`,
  `playwright.config.ts`, and `.github/workflows/ci.yml`; no quality-gate setup step is required.
- Baseline command: `bun install --frozen-lockfile && bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test && bun run build && bun run test:e2e`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck --incremental false`, `bun run db:migrate:test`,
  `bun run db:seed:test`, `bun run build`, `bun run test:e2e`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step,
  validation results, commit reference if available, current status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` before any quality-gate setup or implementation work begins.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]`
  section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with
  human-readable notable changes under the appropriate `Unreleased` change-type headings before
  creating that step's commit.

## Incremental Steps

Every implementation step below must end by running the listed quality gates, fixing any failures
before proceeding, updating `PROGRESS.md`, updating `CHANGELOG.md` under `## [Unreleased]`, and
creating the step's commit. If a failure is proven pre-existing during Step 1, record it in
`PROGRESS.md` and do not hide it in later steps.

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog files the user can consult while the plan is being
executed.

Depends on:
- None

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title, source document paths, a checklist for every step in this plan, current
  status, and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Create `CHANGELOG.md` in the project root before any implementation work begins.
- Add Keep a Changelog 1.0.0 structure: `# Changelog`, the standard preamble, and
  `## [Unreleased]`.
- Add empty change-type headings under `## [Unreleased]` only when they receive entries.
- Document that `CHANGELOG.md` must be updated after each step is completed and validated, before
  that step is committed.

Acceptance Criteria:
- `PROGRESS.md` exists and includes every step from this plan.
- `CHANGELOG.md` exists and follows Keep a Changelog 1.0.0 conventions.

Validation:
- Confirm `PROGRESS.md` exists and contains the step checklist.
- Confirm `CHANGELOG.md` exists and contains `# Changelog`, the standard preamble, and
  `## [Unreleased]`.

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and
  identify Step 1 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress and changelog tracking.

Commit:
- `Add trip sharing progress tracking`

### Step 1: Baseline Quality Gate Run
Goal: Capture the repository's pre-implementation health so later failures can be separated from
pre-existing issues.

Depends on:
- Step 0

Changes:
- Do not change product code.
- Run the baseline gate suite and record results in `PROGRESS.md`.
- If a gate fails for a pre-existing reason, record the failing command, concise error summary, and
  whether implementation can continue.

Acceptance Criteria:
- Baseline validation status is visible in `PROGRESS.md`.
- No feature code has been changed in this step.

Validation:
- Run `bun install --frozen-lockfile`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 2 as next.

Changelog:
- Do not add a changelog entry unless this step changes repo files to document or fix a gate.

Commit:
- `Record trip sharing baseline gates` only if files changed; otherwise no commit.

### Step 2: Define Shared Trip Artifact Contracts
Goal: Create typed, policy-aware saved trip item contracts shared by the chat UI, API routes, and
public share page.

Depends on:
- Step 0
- Step 1

Changes:
- Add a focused module such as `src/server/trips/shared-trip-types.ts` for:
  - `SavedTripItem`
  - `SavedTripItemKind`
  - `SharedTripPlan`
  - saveable payload union for `RecommendationCard`, `ItineraryPlan`, and a future note payload
  - browser-storage DTOs used by the client
- Add Zod schemas or equivalent runtime validators for save/share API payloads.
- Keep source metadata as `AnswerSourceSummary[]` and explicitly exclude raw tool calls, raw
  provider payloads, full assistant message text unless required for a saved note, and exact
  browser geolocation.
- Add helpers to normalize/sanitize saved titles, IDs, source summaries, maps URLs, caveats, and
  artifact payloads.
- Add Bun tests next to the new module, for example `src/server/trips/shared-trip-types.test.ts`.

Acceptance Criteria:
- Saveable card and itinerary artifacts can be validated and normalized without importing React
  components.
- Invalid or oversized payloads are rejected.
- Source summaries are preserved only in the allowed public shape.
- Raw tool call data, unrelated chat messages, and exact coordinates are not part of the saved
  contract.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 3 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for shared trip artifact contracts.

Commit:
- `Define saved trip artifact contracts`

### Step 3: Add Local Saved Items In Chat
Goal: Let travelers save and remove cards and itineraries from the chat UI using browser-local
storage before server persistence is introduced.

Depends on:
- Step 0
- Step 1
- Step 2

Changes:
- Update `src/features/chat/ChatWorkspace.tsx` to:
  - create or load an anonymous local `tripId`
  - hydrate saved items from `localStorage`
  - save recommendation cards as `kind: "place"` or `kind: "beach"`
  - save itinerary artifacts as `kind: "itinerary"`
  - remove saved items
  - keep saved item IDs stable and deduplicate repeated saves
  - show a compact saved-plan tray or drawer in the chat workspace
- Add save/remove controls to `RecommendationCards` and `ItineraryPlans` using existing UI
  primitives and `lucide-react` icons.
- Keep controls accessible with clear labels such as `Save Shaka Siargao` and
  `Remove Shaka Siargao from saved plan`.
- Avoid saving full chat history or user message text with card/itinerary saves.
- Keep mobile layouts inside the existing chat column and avoid overflow.
- Add or update Playwright coverage in `tests/e2e/chat.e2e.ts` for saving, deduping, removing, and
  reload persistence.

Acceptance Criteria:
- Users can save cards and itineraries from assistant responses.
- Saved items appear in a compact saved-plan UI during the session.
- Saved items persist across refresh in the same browser.
- Users can remove saved items.
- No unrelated chat history is written into the saved item payload.
- Existing geolocation single-request behavior still works.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 4 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for browser-local saved trip items in chat.

Commit:
- `Add local saved trip items`

### Step 4: Add Trip Persistence Schema And Store
Goal: Add minimal Postgres-backed persistence for saved trip items and share-token records.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3

Changes:
- Update `src/server/db/schema.ts` with tables such as:
  - `saved_trips`: `id`, optional `userId`, `clientTripKeyHash`, `title`, `createdAt`,
    `updatedAt`
  - `saved_trip_items`: `id`, `tripId`, `kind`, `title`, `payloadJson`, `sourcesJson`,
    `createdAt`, `updatedAt`, optional `deletedAt`
  - `shared_trip_plans`: `id`, `tripId`, `publicTokenHash`, `title`, `itemIdsJson`,
    optional `expiresAt`, optional `deletedAt`, `createdAt`, `updatedAt`
- Update `drizzle/0000_initial_schema.sql` with equivalent DDL, indexes, and foreign keys.
- Update `src/server/db/migration.test.ts` table parity expectations.
- Add a server store module such as `src/server/trips/shared-trip-store.ts` for create/update,
  list, remove, create share token, lookup by token, expiry, and deletion checks.
- Hash public tokens server-side before storing them; return the raw token only at creation time.
- Add PGlite-backed Bun tests for the store.

Acceptance Criteria:
- Migration and Drizzle schema remain in parity.
- Saved items can be persisted, listed, removed, and selected for a share plan.
- Share tokens are stored hashed, are unguessable, and can expire or be deleted.
- Deleted or expired share records are not returned.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 5 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for saved trip persistence and share-token storage.

Commit:
- `Persist saved trip plans`

### Step 5: Add Saved Trip API Routes
Goal: Let the browser sync selected local saved items to the server and create share URLs without
exposing unrelated chat state.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Add route handlers under paths such as:
  - `src/app/api/trips/saved/route.ts` for upserting/listing saved items for the anonymous trip
  - `src/app/api/trips/saved/[itemId]/route.ts` for deletion
  - `src/app/api/trips/share/route.ts` for creating a `SharedTripPlan`
  - `src/app/api/trips/share/[token]/route.ts` or an internal loader for token lookup
- Add implementation modules beside route handlers or under `src/server/trips`.
- Use the Step 2 validators for all request bodies.
- Accept only selected `itemIds` when creating a share plan.
- Rate-limit mutating share routes using existing `src/server/security/rate-limit.ts` patterns if
  practical; otherwise add a scoped follow-up note in `PROGRESS.md`.
- Return only compact DTOs needed by the client: saved item summaries and a share URL.
- Add route tests for validation failures, save/list/delete, share creation, token lookup, expired
  token, deleted token, and cross-trip item selection rejection.

Acceptance Criteria:
- The chat UI can persist selected saved items and request a share URL.
- API routes reject malformed payloads and unrelated item IDs.
- Share-token access never returns full chat history or raw provider payloads.
- Expired or deleted share tokens stop returning content.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 6 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for saved trip API routes and share URL creation.

Commit:
- `Add saved trip share APIs`

### Step 6: Add Public Shared Plan Page
Goal: Render selected saved items at a public token URL with maps links, caveats, and freshness
labels.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5

Changes:
- Add an App Router page such as `src/app/trips/shared/[token]/page.tsx`.
- Add a server-side view module such as `src/features/trips/SharedTripPlanPage.tsx` or
  `src/server/trips/shared-trip-rendering.tsx`.
- Render:
  - plan title
  - saved card items with title, subtitle, maps link, fit reasons, caveats, source label, and
    freshness
  - saved itinerary items with stop sequence, map links, fallbacks, skip guidance, caveats, and
    sources
  - expired/deleted/not-found state without revealing whether a token used to exist
- Reuse existing typography and compact UI patterns; avoid chat transcript layout.
- Add metadata/noindex behavior if product prefers private-by-link pages for the first release.
- Add component-level or route-level tests where practical, plus Playwright coverage for public
  rendering and expired/deleted token behavior.

Acceptance Criteria:
- A valid shared token renders only selected saved items.
- Cards and itineraries keep maps links, caveats, checked/not-checked signals, and source
  freshness labels.
- Full chat history and unrelated saved items are absent from the page.
- Invalid, expired, or deleted tokens do not render the plan.
- The page works on mobile and desktop without text overflow.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 7 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for public shared trip plan pages.

Commit:
- `Render shared trip plans`

### Step 7: Wire Share Creation Into Chat UI
Goal: Let travelers create and copy/open a share link for selected saved items from the chat
workspace.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6

Changes:
- Update `src/features/chat/ChatWorkspace.tsx` to:
  - select which saved items are included in a share plan
  - send selected items to the saved-trip APIs
  - create a share token
  - display a share link with copy and open controls
  - show pending, success, empty-state, and error states
- Keep local-only save/remove behavior usable if the share API fails.
- Ensure the payload sent to the API contains only validated saved item artifacts, not the message
  list or client geolocation.
- Add Playwright tests for share creation from saved card and itinerary fixtures, copy/open link
  affordance, empty saved-plan prevention, and API failure fallback.

Acceptance Criteria:
- Users can create a share link after saving at least one item.
- Users can choose or confirm the selected items included in the shared plan.
- Sharing failure does not delete local saved items.
- The request body for sharing contains only selected saved artifacts and anonymous trip metadata.
- The generated link opens the public shared plan page.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 8 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for share-link creation in chat.

Commit:
- `Connect chat saved items to sharing`

### Step 8: Harden Source Policy And Privacy Tests
Goal: Prove shared plans preserve permitted source metadata while blocking restricted provider
content and private chat context.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6
- Step 7

Changes:
- Add or expand tests under `src/server/trips`, `src/server/providers`, or route tests to cover:
  - citation-only and public-republish source summaries
  - restricted or raw provider fields being stripped
  - Google Places review text not being exposed
  - exact browser geolocation not being persisted or rendered
  - full chat transcript not being accepted by save/share schemas
  - source freshness and not-checked caveats preserved in public DTOs
- Add a small policy projection helper if Step 2's sanitizer is not explicit enough.
- Ensure errors are logged without token, coordinates, or raw payload leakage.

Acceptance Criteria:
- Source-policy tests fail if restricted fields are added to shared payloads.
- Public shared DTOs include allowed trust labels, source names, checked/not-checked arrays, and
  freshness timestamps when allowed.
- Public shared DTOs exclude raw provider payloads, review text, exact geolocation, tool-call
  arguments, and unrelated chat history.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 9 as next.

Changelog:
- Add a `Security` entry under `## [Unreleased]` for shared-plan source-policy and privacy
  hardening.

Commit:
- `Harden shared trip privacy policy`

### Step 9: Update Documentation And Final Verification
Goal: Document the save/share behavior and finish with full validation.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6
- Step 7
- Step 8

Changes:
- Update relevant docs, likely `documentation/developer/reference/environment.md` only if new
  environment variables are introduced.
- Update roadmap or developer docs only if implementation behavior differs from the Priority 11
  plan.
- Add concise implementation notes for:
  - browser-local saved items
  - anonymous `tripId` behavior
  - share-token expiry/deletion behavior
  - source-policy projection rules
- Run the full final quality gate suite.
- Update `PROGRESS.md` and `CHANGELOG.md` before the final commit.

Acceptance Criteria:
- Docs match implemented behavior.
- No undocumented environment variable is required.
- Full gate suite passes or any pre-existing failure is clearly documented with evidence.
- `PROGRESS.md` shows all steps complete and final validation status.
- `CHANGELOG.md` has human-readable entries under `## [Unreleased]`.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, final validation results, commit reference if
  available, and final status.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for documentation updates, if docs changed.
- Confirm all previous feature, fix, and security entries are still grouped under appropriate
  Keep a Changelog headings.

Commit:
- `Document saved trip sharing`
