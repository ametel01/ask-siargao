# Implementation Plan

## Source Documents
- Path: User prompt inline source document, 2026-06-25
  - Role: Primary implementation brief.
  - Summary: Build a Google Places capture and retrieval system that can store every requested Google field in typed Postgres tables, checks DB freshness before provider calls, stores reviews/ratings/prices with attribution and retention governance, normalizes permitted Google data into internal facts, purges expired Google content, and routes chat through a deterministic DB-first `AnswerContextStore` before the LLM.
- Path: `docs/DATA_STRATEGY.md`
  - Role: Supporting product/data strategy.
  - Summary: Ask Siargao should use lazy data acquisition, DB-first fact retrieval, explicit freshness windows, source observations, normalized reusable facts, source-policy enforcement, paid refresh budgets, and special Google Places handling that avoids indefinite raw payload/review storage unless allowed.
- Path: `documentation/developer/reference/scripts.md`
  - Role: Supporting quality-gate and developer workflow reference.
  - Summary: Documents the repository's Bun, Biome, TypeScript, migration, seed, build, and Playwright commands.
- Path: Google Places policies and Google Maps Platform service terms
  - Role: External source-policy constraints.
  - Summary: `place_id` may be stored indefinitely, but Google Maps/Places content has caching and attribution restrictions. Places latitude/longitude caching is limited to 30 days under the service-specific terms, and displayed place details/reviews require Google attribution.

## Goals
- Add a typed Google Places persistence model that captures every Google field the app requests, including prices, ratings, review metadata/text, opening hours, contact fields, location, attribution, and raw response snapshots where policy permits.
- Make chat data retrieval deterministic and DB-first: check fresh, legally reusable Google data in Postgres before calling Google APIs.
- Track `stale_at` separately from `retention_expires_at` so data can be stale before it must be deleted.
- Normalize Google data into governed internal facts with freshness, confidence, attribution requirements, source records, field masks, and reuse scope.
- Replace direct `/api/chat` Google lookup with an `AnswerContextStore.getOrRefresh` flow that returns bounded facts, evidence, source freshness, and gaps to the LLM.
- Add retention cleanup so expired Google details, snapshots, and reviews are purged while durable identifiers such as `place_id` remain.
- Add tests proving fresh DB data avoids API calls, stale data refreshes, expired data is hidden/purged, and the LLM receives freshness labels/gaps instead of raw unrestricted provider payloads.

## Non-Goals
- Do not implement a full trip-pass/payment refresh budget overhaul unless needed to preserve the retrieval seam.
- Do not build an indefinite local clone of Google Places reviews, ratings, raw payloads, or lat/lng data unless the project's Google agreement explicitly allows it.
- Do not add scraping or non-Google review sources.
- Do not expose Google review text or restricted provider payloads on public pages.
- Do not replace Open-Meteo or existing public knowledge surfaces except where `AnswerContextStore` needs compatibility.
- Do not start implementation as part of this planning task.

## Assumptions and Open Questions
- Assumption: The primary source document is the inline brief in the user prompt, because no local source document path was provided. Impact: `PLAN.md` records this as an inline source rather than a file-backed source.
- Assumption: Google Places content that is not explicitly durable should be treated as retention-governed cache. Impact: schema includes rich capture columns but every Google content row must have freshness and retention metadata.
- Assumption: `place_id` is the only Google Places identifier that can be retained indefinitely by default. Impact: retention cleanup must preserve `google_places.place_id` but delete expired details, snapshots, and reviews.
- Assumption: The existing `source_records`, `facts`, and `evidence` tables remain the generic fact graph. Impact: new Google-specific tables reference those tables instead of replacing them.
- Assumption: Full raw `payload_json` storage for Google snapshots is allowed only when source policy says it is permitted. Impact: capture code must support redacted or omitted payloads and should still persist structured typed columns where permitted.
- Open question: Which exact Place Details field mask should production use for review-bearing requests? Impact: broader field masks raise cost and retention obligations, so implementation should define explicit Essentials, Enterprise, and Atmosphere masks instead of using `*`.
- Open question: Should review text ever be sent to the LLM, or only review-derived facts and attribution metadata? Impact: safest initial behavior is to keep review text out of `answerContext` unless explicitly required and still fresh/attributed.
- Open question: How should paid/live-refresh budgets be enforced in the first slice? Impact: the plan includes a policy hook but can initially allow injected tests to simulate allowed/blocked refreshes.

## Quality Gates
- Setup status: Existing gates are configured in `package.json`, `biome.json`, and `.github/workflows/ci.yml`; no quality-gates setup step is required.
- Baseline command: `bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test && bun run build && bun run test:e2e`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck --incremental false`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, `bun run test:e2e`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Ensure `CHANGELOG.md` exists before any quality-gate setup or implementation work begins. This repo already has `CHANGELOG.md`; preserve existing entries and repair the structure only if it no longer follows Keep a Changelog 1.0.0.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with human-readable notable changes under the appropriate `Unreleased` change-type headings before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog tracking the user can inspect while the plan is executed.

Depends on:
- None

Changes:
- Create `PROGRESS.md` in the project root if missing.
- Add the plan title, source list, step checklist, current status, and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Verify `CHANGELOG.md` exists in the project root.
- If `CHANGELOG.md` is missing, create it with Keep a Changelog 1.0.0 structure: `# Changelog`, the standard preamble, and `## [Unreleased]`.
- If `CHANGELOG.md` already exists, preserve existing entries and only adjust structure if required to keep `# Changelog`, the standard preamble, and `## [Unreleased]`.

Acceptance Criteria:
- `PROGRESS.md` exists and lists every step in this plan.
- `CHANGELOG.md` exists and has `# Changelog`, a Keep a Changelog preamble, and an `## [Unreleased]` section.
- No feature implementation has started.

Validation:
- Run `test -f PROGRESS.md`
- Run `test -f CHANGELOG.md`
- Run `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and identify Step 1 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing this Google Places persistence progress plan, after validation and before committing.

Commit:
- `chore: track google places persistence plan progress`

### Step 1: Google Places Schema And Migration
Goal: Add typed Postgres tables for Google Places capture while keeping the existing generic fact graph intact.

Depends on:
- Step 0

Changes:
- Update `src/server/db/schema.ts` with Drizzle exports for:
  - `googlePlaces`
  - `googlePlaceSnapshots`
  - `googlePlaceDetails`
  - `googlePlaceReviews`
- Update `drizzle/0000_initial_schema.sql` with matching SQL tables.
- Use `text` primary keys for deterministic IDs, `jsonb` for Google nested objects, `numeric` for ratings/location numeric fields where appropriate, and `timestamp(..., { withTimezone: true })` for `fetched_at`, `stale_at`, and `retention_expires_at`.
- Add references:
  - `google_places.latest_source_record_id -> source_records.id`
  - `google_places.canonical_entity_id -> entities.id`
  - `google_place_snapshots.place_id -> google_places.place_id`
  - `google_place_snapshots.source_record_id -> source_records.id`
  - `google_place_details.place_id -> google_places.place_id`
  - `google_place_reviews.place_id -> google_places.place_id`
  - `google_place_reviews.snapshot_id -> google_place_snapshots.id`
- Include fields from the source brief:
  - `google_places`: `place_id`, `resource_name`, `latest_source_record_id`, `canonical_entity_id`, `first_seen_at`, `last_seen_at`, `last_details_fetched_at`, `details_stale_at`.
  - `google_place_snapshots`: `id`, `place_id`, `source_record_id`, `request_kind`, `field_mask`, `payload_json`, `payload_hash`, `fetched_at`, `stale_at`, `retention_expires_at`, `storage_policy`, `attribution_json`.
  - `google_place_details`: `place_id`, `display_name_json`, `formatted_address`, `short_formatted_address`, `address_components_json`, `location_json`, `viewport_json`, `types_json`, `primary_type`, `business_status`, `google_maps_uri`, `website_uri`, phone fields, `opening_hours_json`, `price_level`, `price_range_json`, `rating`, `user_rating_count`, `payment_options_json`, `parking_options_json`, `amenities_json`, `attributions_json`, `fetched_at`, `stale_at`, `retention_expires_at`.
  - `google_place_reviews`: `id`, `place_id`, `snapshot_id`, `review_name`, `relative_publish_time_description`, `rating`, `text_json`, `original_text_json`, `author_attribution_json`, `publish_time`, `flagged_content`, `fetched_at`, `stale_at`, `retention_expires_at`, `display_requires_google_attribution`.
- Update `src/server/db/migration.test.ts` to require the new tables and keep Drizzle schema exports in migration parity.
- Add any necessary indexes in SQL for `place_id`, `stale_at`, and `retention_expires_at` lookups if the current migration style accepts indexes.

Acceptance Criteria:
- PGlite migration creates all four Google tables.
- Drizzle table exports remain in parity with the SQL migration.
- Existing fact graph tables are unchanged except for new foreign-key references from Google tables.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/db/migration.test.ts`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 1 completion notes, validation results, commit reference if available, current status, and Step 2 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for the Google Places capture schema after validation and before committing.

Commit:
- `feat: add google places capture schema`

### Step 2: Google Places Freshness, Retention, And Field Policy Module
Goal: Centralize Google field masks, stale windows, storage policies, attribution requirements, and retention calculations.

Depends on:
- Step 1

Changes:
- Add `src/server/providers/google-places-policy.ts`.
- Define explicit field mask groups instead of using wildcard masks:
  - Search/chat fields currently used by `google-places-chat.ts`.
  - Details identity/contact fields.
  - Enterprise fields such as `rating`, `userRatingCount`, `priceLevel`, `priceRange`, and opening hours.
  - Atmosphere/review fields such as `reviews`, `reviewSummary`, amenities, payment options, and parking options.
- Add a typed freshness policy:
  - `business_status`: 7 days.
  - `rating` and `user_rating_count`: 7 days.
  - `reviews`: 7 days or less.
  - `price_level` and `price_range`: 14 days.
  - `opening_hours`: 3-7 days.
  - `website`, phone, and address: 30 days.
  - `place_id`: indefinite.
  - lat/lng from Places: maximum 30 days unless replaced by user/provider-owned data.
- Add helpers to compute `stale_at`, `retention_expires_at`, and `storage_policy` for each request kind and field group.
- Add helpers to decide whether a row is fresh, stale, expired, or not legally reusable.
- Add helpers to build attribution metadata from Google response data.
- Add tests in `src/server/providers/google-places-policy.test.ts`.

Acceptance Criteria:
- Every Google request kind has an explicit field mask and no production helper uses `*`.
- Freshness and retention are computed separately.
- Tests prove stale rows can still exist before deletion, expired rows are blocked from reuse, and `place_id` is treated as durable.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/providers/google-places-policy.test.ts`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 2 completion notes, validation results, commit reference if available, current status, and Step 3 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for Google Places freshness and retention policy after validation and before committing.

Commit:
- `feat: add google places freshness policy`

### Step 3: Google Places Capture Repository
Goal: Add a database module that upserts Google Places captures, details, reviews, source records, and normalized facts deterministically.

Depends on:
- Step 2

Changes:
- Add `src/server/providers/google-places-store.ts`.
- Add repository methods such as:
  - `findFreshPlacesForSearchRequirement(...)`
  - `findFreshPlaceDetails(...)`
  - `upsertGoogleSearchSnapshot(...)`
  - `upsertGooglePlaceDetails(...)`
  - `upsertGooglePlaceReviews(...)`
  - `normalizeGooglePlaceFacts(...)`
  - `deleteExpiredGooglePlacesContent(...)`
- Use deterministic IDs based on provider, request kind, place ID, field mask, and fetched window.
- Persist Google rows into the new typed tables and the generic `source_records`, `facts`, and `evidence` tables.
- Normalize internal facts such as:
  - `google_rating_signal`
  - `google_review_count_signal`
  - `google_price_signal`
  - `google_open_now_signal`
  - `restaurant_candidate`
  - `family_fit_signal`
  - `quiet_sleep_signal`
  - `map_link`
- Ensure normalized facts carry source record, field mask, fetched time, stale time, confidence, attribution needs, and reuse scope in `notes`, `claim`, `evidence`, or a narrowly scoped JSON metadata field if one is added later.
- Add PGlite-backed tests that prove upserts are idempotent and do not duplicate logical rows.

Acceptance Criteria:
- Google captures can be written and read from Postgres without calling Google.
- Re-running the same capture does not create duplicate `google_places`, details, reviews, facts, or evidence rows.
- Review rows include attribution, freshness, retention, and display attribution requirements.
- Expired Google content is not returned by fresh lookup methods.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/providers/google-places-store.test.ts`
- Run `bun test src/server/providers/google-places-policy.test.ts`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 3 completion notes, validation results, commit reference if available, current status, and Step 4 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for Google Places capture persistence and fact normalization after validation and before committing.

Commit:
- `feat: persist google places captures`

### Step 4: Google Provider Adapter Refactor
Goal: Extend the Google provider adapter so fetched data can be captured completely and reused by the store without losing fields.

Depends on:
- Step 3

Changes:
- Update `src/server/providers/google-places-chat.ts` to expose parsed response payloads or a capture-ready normalized structure without losing requested fields.
- Add or update a Place Details adapter, likely in `src/server/providers/google-places-enrichment.ts` or a new `src/server/providers/google-places-details.ts`, to support review-bearing details requests behind explicit field masks.
- Include prices, ratings, review data, attributions, phone fields, website, opening hours, business status, location, types, amenities, payment options, and parking options when those fields are requested.
- Preserve existing `GooglePlacesChatContext` behavior for compatibility until `/api/chat` is switched to `AnswerContextStore`.
- Ensure fetch helpers accept injected fetchers and timestamps for deterministic tests.
- Update `src/server/providers/google-places-chat.test.ts` and add details/capture adapter tests.

Acceptance Criteria:
- Provider parsing can represent every field the app requests.
- Existing chat provider tests still pass.
- Review-bearing details requests use explicit field masks and do not rely on wildcard fields.
- Fetchers are injectable and do not require live Google API calls in tests.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/providers/google-places-chat.test.ts`
- Run `bun test src/server/providers/google-places-enrichment.test.ts`
- Run `bun test src/server/providers/google-places-store.test.ts`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 4 completion notes, validation results, commit reference if available, current status, and Step 5 as next.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for capture-ready Google provider parsing after validation and before committing.

Commit:
- `feat: make google places adapters capture ready`

### Step 5: Answer Context Store DB-First Retrieval
Goal: Introduce a deep module that checks Postgres freshness before any Google API call and returns bounded answer context to chat generation.

Depends on:
- Step 4

Changes:
- Add `src/server/chat/answer-context-store.ts`.
- Add request and result types such as:
  - `AnswerContextRequest`
  - `AnswerContext`
  - `AnswerFact`
  - `EvidenceSummary`
  - `FactGap`
  - `SourceFreshness`
- Move or wrap the current chat-route Google search detection logic into reusable planner helpers.
- Implement `getOrRefresh`:
  - persist or accept the user message ID when chat memory exists.
  - classify intent and required Google fields.
  - check DB for fresh place IDs, details, reviews, ratings, prices, and opening data.
  - compare `stale_at` and `retention_expires_at`.
  - use DB rows when fresh and legally reusable.
  - call Google only when data is missing, stale, expired, or insufficient and source policy/budget allows it.
  - persist normalized capture and facts after permitted fetches.
  - return bounded facts, evidence, gaps, source freshness, live refresh count, and estimated provider cost.
- Add injectable dependencies for database, Google adapter, clock, and live-refresh policy.
- Add tests proving:
  - fresh Google rating/price/review rows avoid API calls.
  - stale rows trigger refresh.
  - expired rows are not passed to the LLM.
  - missing DB data triggers Google only when policy permits.
  - blocked refreshes return gaps.

Acceptance Criteria:
- `AnswerContextStore` is the only module that decides whether Google is called for chat answer context.
- Tests can exercise DB-first and refresh behavior without the Next route.
- Returned context includes freshness labels and gaps.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/answer-context-store.test.ts`
- Run `bun test src/server/providers/google-places-store.test.ts`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 5 completion notes, validation results, commit reference if available, current status, and Step 6 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for DB-first answer context retrieval after validation and before committing.

Commit:
- `feat: add db first answer context store`

### Step 6: LLM Adapter Answer Context Contract
Goal: Ensure the LLM uses only bounded `answerContext` facts and cannot bypass freshness or provider policy.

Depends on:
- Step 5

Changes:
- Update `src/server/llm/chat-adapter.ts` to accept `answerContext` in addition to, or instead of, direct `placesContext`.
- Add system/developer instructions:
  - Use only `answerContext` facts for live/provider-specific claims.
  - Do not claim live Google data was checked unless `answerContext.sourceFreshness` says it was fetched or refreshed.
  - If required Google fields are missing, stale, expired, or blocked by retention policy, state the gap.
  - Never call or suggest calling Google directly.
  - Include Google Maps links and attribution requirements when answer context marks them required.
- Keep temporary compatibility for weather context if it is not yet migrated.
- Update `src/server/llm/chat-adapter.test.ts` to prove the prompt includes the new constraints and that stale/missing gaps are exposed.

Acceptance Criteria:
- The LLM receives bounded facts, freshness labels, attribution hints, and gaps.
- The LLM adapter does not receive raw Google payloads by default.
- Tests verify the no-bypass instruction.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/llm/chat-adapter.test.ts`
- Run `bun test src/server/chat/answer-context-store.test.ts`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 6 completion notes, validation results, commit reference if available, current status, and Step 7 as next.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for the LLM answer-context contract after validation and before committing.

Commit:
- `feat: constrain chat generation to answer context`

### Step 7: `/api/chat` Integration
Goal: Replace direct chat-route Google provider calls with `AnswerContextStore.getOrRefresh`.

Depends on:
- Step 6

Changes:
- Update `src/app/api/chat/chat-route.ts`.
- Replace direct calls to `getGooglePlacesChatContext` with:
  - `const answerContext = await answerContextStore.getOrRefresh({ tripId, userMessageId, messages });`
- If full trip/chat memory tables are not yet implemented, use a deterministic request-scoped user message ID as a compatibility shim and record the follow-up in `PROGRESS.md`.
- Update `ChatRouteDependencies` so tests can inject `answerContextStore`.
- Keep weather behavior working, either as existing `weatherContext` or through `answerContext` if migrated during this step.
- Update `src/app/api/chat/route.test.ts`:
  - fresh DB answer context avoids Google calls.
  - stale/missing data invokes the injected refresh path.
  - ordinary chat does not trigger Google requirements.
  - LLM receives `answerContext` with freshness and gaps.

Acceptance Criteria:
- `/api/chat` no longer directly calls Google Places for recommendation questions.
- The route delegates DB-first retrieval and refresh decisions to `AnswerContextStore`.
- Existing chat behavior remains stable for unrelated topic declines, weather questions, ordinary chat, and OpenAI missing-config responses.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test src/server/chat/answer-context-store.test.ts`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 7 completion notes, validation results, commit reference if available, current status, and Step 8 as next.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for routing chat through DB-first answer context after validation and before committing.

Commit:
- `feat: route chat through db first answer context`

### Step 8: Retention Cleanup Job And Script
Goal: Add an explicit cleanup path for expired Google Places content.

Depends on:
- Step 7

Changes:
- Add `src/server/providers/prune-google-places.ts` or `src/server/jobs/prune-google-places.ts`.
- Add a package script such as `db:prune:google-places`.
- Delete expired rows from:
  - `google_place_reviews` where `retention_expires_at < now()`.
  - `google_place_details` where `retention_expires_at < now()`.
  - `google_place_snapshots` where `retention_expires_at < now()`.
- Preserve `google_places.place_id` and durable identity rows.
- Ensure cleanup order respects foreign keys.
- Add dry-run mode if consistent with existing provider scripts.
- Add tests proving expired content is deleted, fresh content remains, and place IDs survive cleanup.

Acceptance Criteria:
- Cleanup can be run locally against `DATABASE_URL`.
- Expired details, reviews, and snapshots are removed.
- Durable `place_id` records remain.
- Cleanup is documented in script references.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/providers/google-places-store.test.ts`
- Run `bun test src/server/jobs/prune-google-places.test.ts` if the job has a separate test file.
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 8 completion notes, validation results, commit reference if available, current status, and Step 9 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for Google Places retention cleanup after validation and before committing.

Commit:
- `feat: add google places retention cleanup`

### Step 9: Documentation And Operator Guidance
Goal: Document the Google Places capture model, DB-first chat flow, retention rules, and operational commands.

Depends on:
- Step 8

Changes:
- Update `docs/DATA_STRATEGY.md` with the concrete Google capture tables, freshness windows, retention distinction, and DB-first `AnswerContextStore` flow.
- Update `documentation/developer/explanation/siargao-chatbot-data-pipeline.md` with the new Google capture and retention lifecycle.
- Update `documentation/developer/reference/scripts.md` with any new prune or Google details scripts.
- Update `documentation/developer/reference/environment.md` if any new environment variables or Google field-mask controls are added.
- Add a short operator note that Google review text and other restricted content must not be promoted to public pages or retained indefinitely unless the agreement explicitly allows it.

Acceptance Criteria:
- Developer docs explain how and why Google data is stored, refreshed, reused, attributed, and purged.
- Script docs match `package.json`.
- Source-policy limitations are explicit enough that future agents do not treat Google reviews as permanent product data.

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
- Update `PROGRESS.md` with Step 9 completion notes, validation results, commit reference if available, current status, and Step 10 as next.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for Google Places persistence and retention documentation after validation and before committing.

Commit:
- `docs: document google places persistence lifecycle`

### Step 10: End-To-End Verification Slice
Goal: Verify the user-visible chat path uses stored Google data when fresh and refreshes only when needed.

Depends on:
- Step 9

Changes:
- Add or update integration tests covering `/api/chat` with an injected or seeded Google DB context.
- Add an e2e or mocked browser test if practical:
  - Ask for restaurants near Cloud 9.
  - Confirm the assistant response can be generated from fresh stored Google facts.
  - Confirm source freshness or gap language is rendered when data is stale/missing.
- Ensure tests do not require live Google or OpenAI credentials.
- Confirm no expired review text or raw Google payload reaches the client.

Acceptance Criteria:
- Test coverage proves the end-to-end chat path respects DB-first retrieval.
- Fresh stored Google data avoids provider calls.
- Stale or missing data follows the refresh/gap path.
- Restricted or expired Google content is not sent to the LLM or client.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test src/server/chat/answer-context-store.test.ts`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with Step 10 completion notes, validation results, commit reference if available, current status, and mark the implementation plan complete.

Changelog:
- Add an `Added` or `Fixed` entry under `## [Unreleased]` for end-to-end DB-first Google chat verification after validation and before committing.

Commit:
- `test: verify db first google chat flow`

## Rollback And Operational Notes
- The schema step adds new tables without removing existing tables, so rollback can initially ignore the new tables and revert chat to direct transient Google context if needed.
- Do not run destructive cleanup until retention policies are validated with seeded test data.
- If production already contains Google-derived rows in generic tables, add a one-off migration plan before enabling cleanup.
- Avoid broad production field masks. Use explicit masks and record each field mask in `google_place_snapshots.field_mask`.
- Keep live Google API tests mocked. Manual live verification should be a separate operator task using `GOOGLE_API_KEY` and a local or staging database.
