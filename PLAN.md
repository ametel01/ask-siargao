# Implementation Plan

## Source Documents
- Path: `/Users/alexmetelli/source/ask-siargao/documentation/developer/reference/clerk-auth-session-chat-history-requirements.md`
  - Role: Primary requirements specification.
  - Summary: Defines the Clerk-backed authentication, local user sync, persisted
    chat history, profile data, assistant response ratings, saved-trip ownership,
    privacy constraints, implementation phases, and test requirements for Ask
    Siargao.

## Goals
- Add Clerk sign-in, sign-up, sign-out, and browser session persistence without
  custom password, session-cookie, or token storage.
- Keep anonymous `/chat` usable while giving signed-in users persisted chat
  threads, cross-session history, profile details, response ratings, and
  account-owned saved trips.
- Sync Clerk users into the existing `users` table using Clerk user IDs as
  `users.id`.
- Protect all authenticated data surfaces with Clerk-derived identity and never
  trust user IDs from request bodies.
- Preserve existing shared-trip privacy guarantees: public share links must not
  expose owners, full chat history, profile details, exact geolocation, private
  provider data, raw provider payloads, or non-public Google review fields.

## Non-Goals
- Replacing Clerk identity management with custom auth, password storage, custom
  session cookies, or local token storage.
- Making anonymous chat private-only; `/chat` remains public unless the user
  explicitly changes the product decision.
- Changing Stripe, audit report delivery, public knowledge pages, or provider
  ingestion beyond any route-matcher updates required by Clerk proxy behavior.
- Using Ask Siargao profile details in agent prompts in this slice. Store and
  edit profile details first; prompt personalization can be a later feature.
- Supporting rating values beyond binary `up` and `down`.
- Exposing private authenticated data through public shared-trip token pages.

## Definition of Done
- `@clerk/nextjs` is installed, documented, and wired through `src/proxy.ts`,
  `ClerkProvider`, `/sign-in`, `/sign-up`, and signed-in/signed-out chat UI.
- Environment references include Clerk publishable, secret, webhook, and redirect
  variables in `.env.example` and
  `documentation/developer/reference/environment.md`, with server-only Clerk
  secrets not using the `NEXT_PUBLIC_` prefix.
- The database migration and Drizzle schema include the changed `users` and
  `saved_trips` shapes plus `user_profiles`, `chat_threads`, `chat_messages`,
  and `chat_response_ratings`, with migration parity tests covering tables,
  columns, keys, indexes, and foreign keys.
- `POST /api/clerk/webhooks` verifies Clerk webhook signatures, processes
  `user.created`, `user.updated`, and `user.deleted`, returns `2xx` only after
  local mutation succeeds, and has tests for success and failure paths.
- Authenticated request paths that need a user derive identity from Clerk
  `auth()` or session claims and tolerate eventual webhook delivery by ensuring
  the local user row exists when needed.
- `/api/me/profile` supports authenticated `GET` and `PATCH` for Ask
  Siargao-specific profile data only, with Clerk identity fields read-only from
  the app profile API.
- Authenticated `/api/chat` requests can create or append to owned threads,
  persist the latest user turn and assistant response, return `threadId`,
  `userMessageId`, and `assistantMessageId`, and keep anonymous requests
  stateless.
- Chat persistence stores only assistant-visible/public artifacts and redacted
  public tool calls; exact browser coordinates, raw provider payloads, private
  tool inputs, and non-public Google review text/attribution are not persisted.
- `/api/chat/threads`, `/api/chat/threads/[threadId]`, and `/api/chat/ratings`
  enforce Clerk auth, owner checks, `401` for unauthenticated users, and `404`
  for other users' threads/messages/ratings.
- Signed-in chat UI can start a new thread, list previous threads, hydrate a
  selected thread, rename/archive/delete threads, persist after reload, and show
  no history to anonymous users.
- Assistant response rating controls are accessible icon buttons, save disabled
  and selected states, support rating updates, reject user-message ratings, and
  survive reload.
- Authenticated saved-trip APIs associate rows with `user_id`, support listing
  by current user without requiring `tripId`, preserve anonymous `tripId`
  behavior, verify ownership on delete and share creation, and migrate the
  current anonymous `local_trip_*` row to the signed-in user when safe.
- Documentation for routes, environment variables, and user-owned data privacy is
  current.
- `PROGRESS.md` and `CHANGELOG.md` are current. `CHANGELOG.md` follows Keep a
  Changelog 1.0.0 conventions.
- Required quality gates pass, or any failures are documented as pre-existing
  with evidence from the baseline run.

## Assumptions and Open Questions
- Assumption: Anonymous chat remains available. Impact: `src/proxy.ts` keeps
  `/chat` and `/api/chat` public while `/api/chat` persists only when Clerk auth
  is present.
- Assumption: `user.deleted` should anonymize identity cache fields and set
  `deleted_at`, not hard-delete the `users` row or dependent data. Impact:
  foreign keys remain valid and private user-owned data remains inaccessible to
  deleted identities.
- Assumption: Ratings are binary `up` and `down`, as specified. Impact: Zod
  route validation and UI should not add a 1-5 scale.
- Assumption: Profile details are stored and editable but not injected into agent
  prompts in this implementation. Impact: personalization is deferred and easier
  to review separately.
- Assumption: Local-to-account saved-trip migration happens automatically when a
  signed-in browser syncs its current `local_trip_*` key, but only when the saved
  trip is unowned or already owned by that user. Impact: cross-user conflicts
  return a safe response and do not transfer data.
- Open question: Should deleted Clerk users be fully anonymized immediately or
  only soft-deleted with email retained for operational retention? Conservative
  implementation should anonymize app-cached identity fields unless the user
  chooses a different retention policy before Step 3.

## Implementation Approach
- Use vertical slices that keep the repo working after each commit. Start with
  tracking files and a baseline gate run, then add Clerk shell integration,
  schema, server auth/user sync, profile, chat persistence, chat history UI,
  ratings, saved-trip ownership, and final documentation/validation.
- Use Clerk as the sole source of authentication identity. Add a small server
  auth/user helper layer around `auth()` and Clerk claims so route handlers can
  derive `userId`, ensure a local `users` row exists, and keep tests mockable.
- Keep public and authenticated behavior compatible. Anonymous API paths continue
  using current request shapes unless an authenticated session is present.
- Add `src/proxy.ts` for Next 16 with public routes for `/`, `/chat`,
  `/sign-in(.*)`, `/sign-up(.*)`, `/trips/shared(.*)`, `/api/chat`,
  `/api/trips/saved(.*)`, `/api/trips/share(.*)`, `/api/public(.*)`,
  `/api/stripe/webhook`, and `/api/clerk/webhooks`; protect `/profile(.*)`,
  `/chat/history(.*)` if added, `/api/me(.*)`, `/api/chat/threads(.*)`, and
  `/api/chat/ratings(.*)`.
- Add database changes in `src/server/db/schema.ts` and
  `drizzle/0000_initial_schema.sql`, then update PGlite migration parity tests
  before implementing route behavior that depends on the new tables.
- Keep route logic testable by following the existing dependency-injection style
  in `src/app/api/chat/chat-route.ts` and `src/app/api/trips/trip-routes.ts`.
- Persist chat context summaries, not raw browser or provider data. Store only
  public `sources`, `cards`, `actions`, `itineraries`, and redacted public
  `toolCalls` already prepared for responses.
- Return `404`, not `403`, when an authenticated user references another user's
  thread, message, saved trip, or rating.
- Update docs and tests in the same step as the behavior they cover so each
  commit remains reviewable and independently useful.

## Quality Gates
- Setup status: Existing gates found in `package.json`, `biome.json`,
  `tsconfig.json`, `playwright.config.ts`, `drizzle.config.ts`, and
  `.github/workflows/ci.yml`. No quality-gate setup step is required.
- Baseline command: `bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test && bun run build && bun run test:e2e`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck --incremental false`; `bun run db:migrate:test`; `bun run db:seed:test`; `bun run build`; `bun run test:e2e`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or
  implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the
  completed step, validation results, commit reference if available, current
  status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Ensure `CHANGELOG.md` exists before any quality-gate setup or
  implementation work begins. If it already exists, preserve existing entries
  and normalize only the parts required for this plan.
- Initial content: Include `# Changelog`, the standard preamble, and an
  `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update
  `CHANGELOG.md` with human-readable notable changes under the appropriate
  `Unreleased` change-type headings before creating that step's commit.

## Goal Handoff
- Readiness: This plan is ready to be used as a `/goal` payload.
- Scope: The `/goal` should execute only the work described in this plan unless
  the user explicitly expands it.
- Done: The `/goal` is complete only when every item in
  `## Definition of Done` is satisfied, all incremental steps are complete,
  required quality gates pass or documented pre-existing failures are handled,
  `PROGRESS.md` and `CHANGELOG.md` are current, and the final state is
  summarized for the user.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog files the user can consult while the
plan is being executed.

Depends on:
- None

Changes:
- Create `PROGRESS.md` in the project root.
- Add this plan title, source document path, a step checklist, current status,
  and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Inspect existing `CHANGELOG.md`. Preserve existing content.
- If needed, adjust `CHANGELOG.md` to follow Keep a Changelog 1.0.0 structure:
  `# Changelog`, the standard preamble, and `## [Unreleased]`.
- Document that `CHANGELOG.md` must be updated after each step is completed and
  validated, before that step is committed.

Acceptance Criteria:
- `PROGRESS.md` exists and contains the step checklist from this plan.
- `CHANGELOG.md` exists, preserves prior release notes, and has a usable
  `## [Unreleased]` section.
- The repository remains otherwise unchanged except for tracking files.

Advances Definition of Done:
- Establishes the required progress and changelog tracking before implementation
  begins.

Validation:
- Run `test -f PROGRESS.md`
- Run `test -f CHANGELOG.md`
- Run `rg -n "^## \\[Unreleased\\]" CHANGELOG.md`

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the
  current status, and identify Step 1 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress and
  changelog tracking.

Commit:
- `Track Clerk auth plan progress`

Step completion sequence:
1. Run all quality gates required for this step: the validation commands above.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 1: Baseline Quality Gate Run
Goal: Capture the pre-implementation quality state so future failures can be
separated from pre-existing failures.

Depends on:
- Step 0

Changes:
- Run the baseline command from `## Quality Gates`.
- Record pass/fail status, timestamps, and notable pre-existing failures in
  `PROGRESS.md`.
- Do not change source code in this step unless required to keep tracking files
  accurate.

Acceptance Criteria:
- The baseline command has been attempted once from the project root.
- `PROGRESS.md` records each command result.
- Any failed command has enough error detail recorded to distinguish
  pre-existing failures from later regressions.

Advances Definition of Done:
- Establishes the validation baseline required before feature work begins.

Validation:
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 2 as next.

Changelog:
- Update `CHANGELOG.md` only if this step changes tracked project behavior or
  documentation. Otherwise note in `PROGRESS.md` that no changelog entry was
  needed for a baseline-only step.

Commit:
- `Record baseline quality gates`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding, except document clearly if a failure is
   confirmed pre-existing and outside this plan.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading when applicable.
5. Create a commit for this completed step if tracking files changed.

### Step 2: Clerk Shell Integration
Goal: Add Clerk package, environment documentation, proxy route protection,
layout provider, auth pages, and basic chat-header signed-in/signed-out actions.

Depends on:
- Step 0
- Step 1

Changes:
- Add `@clerk/nextjs` to `package.json` and `bun.lock` with `bun add
  @clerk/nextjs`.
- Update `.env.example` and
  `documentation/developer/reference/environment.md` with:
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `CLERK_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
  `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, and
  `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`.
- Add `src/proxy.ts` using Clerk middleware/proxy patterns for Next 16 and the
  public/protected route lists from the requirements.
- Wrap `src/app/layout.tsx` with `ClerkProvider` inside `<body>` while
  preserving font variables, `TooltipProvider`, and `Toaster`.
- Add `src/app/sign-in/[[...sign-in]]/page.tsx` and
  `src/app/sign-up/[[...sign-up]]/page.tsx` using Clerk prebuilt components.
- Update `src/features/chat/ChatWorkspace.tsx` and any local header component it
  extracts to show signed-out sign-in/sign-up actions and a signed-in
  `UserButton`.
- Add focused tests for proxy route classification where practical, using a
  pure exported matcher helper if direct middleware testing is brittle.

Acceptance Criteria:
- The app builds with Clerk provider wiring in place.
- Public routes remain public and protected data routes require Clerk auth.
- `/sign-in` and `/sign-up` render Clerk prebuilt flows.
- `/chat` shows appropriate signed-in or signed-out actions without blocking
  anonymous chat.

Advances Definition of Done:
- Satisfies the base Clerk integration, environment, and UI shell requirements.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 3 as next.

Changelog:
- Add `Added` entries for Clerk auth shell, auth pages, and environment
  configuration.

Commit:
- `Add Clerk auth shell`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 3: Auth Data Schema and Migration
Goal: Add the database foundation for Clerk users, profiles, chat history,
ratings, and authenticated saved-trip ownership.

Depends on:
- Step 0
- Step 1
- Step 2

Changes:
- Update `src/server/db/schema.ts`:
  - Extend `users` with `firstName`, `lastName`, `imageUrl`,
    `clerkUpdatedAt`, `lastSeenAt`, and `deletedAt` plus indexes.
  - Add `userProfiles`.
  - Add `chatThreads`.
  - Add `chatMessages`.
  - Add `chatResponseRatings` with unique `(user_id, message_id)`.
  - Add `saved_trips` indexes for authenticated lookup while preserving
    anonymous `client_trip_key_hash` support.
- Update `drizzle/0000_initial_schema.sql` with idempotent SQL for the same
  columns, tables, keys, defaults, indexes, and foreign keys.
- Update `src/server/db/migration.test.ts` to include the new tables and changed
  column/key/index expectations.
- Keep existing saved-trip anonymous uniqueness behavior compatible. If the
  proposed unique authenticated index conflicts with current global
  `client_trip_key_hash` uniqueness, document the chosen compatibility behavior
  in the test and schema comments.

Acceptance Criteria:
- PGlite migration creates all new tables and indexes.
- Drizzle schema table exports match migrated tables.
- Existing tests for saved trips and public data still pass.
- No route depends on tables before this step is complete.

Advances Definition of Done:
- Satisfies the schema and migration requirements needed by user sync, profile,
  chat history, ratings, and saved-trip ownership.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 4 as next.

Changelog:
- Add `Added` entries for auth/profile/chat/rating tables and `Changed` entries
  for user and saved-trip schema updates.

Commit:
- `Add auth data schema`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 4: Clerk User Sync and Auth Helpers
Goal: Sync Clerk user lifecycle events into local users and provide a mockable
server helper for authenticated request paths.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3

Changes:
- Add a server-only helper module such as `src/server/auth/clerk-users.ts` for:
  - deriving the authenticated Clerk user ID from `auth()`;
  - ensuring a local `users` row from session claims when a webhook has not
    arrived yet;
  - updating `last_seen_at`;
  - normalizing Clerk user event payloads into local user fields;
  - anonymizing and soft-deleting local users on `user.deleted`.
- Add `src/app/api/clerk/webhooks/route.ts` that calls `verifyWebhook(req)` from
  `@clerk/nextjs/webhooks`, handles `user.created`, `user.updated`, and
  `user.deleted`, and returns `2xx` only after local mutation succeeds.
- Add Bun tests for webhook verification success/failure, create/update upsert,
  delete anonymization/soft-delete behavior, and eventual-consistency
  `ensureCurrentUser` behavior.
- Keep `/api/clerk/webhooks` public in `src/proxy.ts` while verifying the
  signature inside the route handler.

Acceptance Criteria:
- Clerk webhook requests without valid signatures fail.
- Valid user create/update events upsert `users` using Clerk IDs as `users.id`.
- Valid delete events anonymize identity cache fields and set `deleted_at`.
- Authenticated route helpers never accept user IDs from request bodies.

Advances Definition of Done:
- Satisfies Clerk user sync, deletion handling, and synchronous auth-helper
  requirements.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 5 as next.

Changelog:
- Add `Added` entries for Clerk webhook sync and auth helper behavior.

Commit:
- `Sync Clerk users locally`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 5: Profile API and UI
Goal: Let signed-in users view Clerk-derived display identity and edit Ask
Siargao-specific profile details.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Add `src/app/api/me/profile/route.ts` and a testable handler module for:
  - `GET` returning Clerk-derived identity plus `user_profiles`;
  - `PATCH` updating only application profile fields;
  - `401` when unauthenticated;
  - Zod validation for arrays, strings, booleans, and bounded free-text fields.
- Add profile store functions under `src/server/users` or `src/server/profile`
  following existing server module conventions.
- Add `src/app/profile/page.tsx` and a focused client/server UI under
  `src/features/profile` for profile details.
- Use Clerk `UserButton` or account portal affordance for account identity
  management, not custom email/sign-in-method editing.
- Add Bun tests for profile authorization, validation, create-on-first-edit, and
  identity field immutability.
- Add or update Playwright coverage for profile edits persisting.

Acceptance Criteria:
- Signed-in users can load and update profile details.
- Anonymous users receive `401` from `/api/me/profile` and are redirected or
  prompted by the protected `/profile` page.
- The profile API cannot update Clerk-owned identity fields.
- Profile UI distinguishes app profile details from account identity management.

Advances Definition of Done:
- Satisfies profile API and frontend requirements.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 6 as next.

Changelog:
- Add `Added` entries for profile API and profile UI.

Commit:
- `Add user profile management`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 6: Authenticated Chat Persistence
Goal: Persist authenticated chat turns while preserving anonymous stateless chat
behavior and existing privacy controls.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Extend the `/api/chat` request schema in `src/app/api/chat/chat-route.ts` with
  optional `threadId`.
- Add chat store functions under `src/server/chat` or `src/server/chat-history`
  for creating threads, checking ownership, appending user/assistant messages,
  updating `last_message_at`, and reading public message artifacts.
- In authenticated requests:
  - call the auth helper;
  - create a thread when `threadId` is omitted;
  - verify ownership when `threadId` is present;
  - persist the latest user message before or around agent execution;
  - persist the assistant response after public-source validation and tool-call
    redaction;
  - persist error status only if the chosen behavior is useful and tested;
  - return `threadId`, `userMessageId`, and `assistantMessageId`.
- In anonymous requests, keep the current stateless response shape except for
  any backward-compatible optional fields already used by the UI.
- Persist only context summaries for geolocation: status, source, consent scope,
  and whether location was used as a proximity anchor. Do not persist exact
  browser coordinates.
- Add Bun tests for authenticated persistence, ownership `404`, anonymous
  stateless behavior, and privacy redaction of persisted artifacts.

Acceptance Criteria:
- Authenticated chat creates and appends to owned threads.
- Anonymous chat remains usable and stateless.
- Cross-user `threadId` access returns `404`.
- Persisted messages exclude exact geolocation, raw provider payloads, private
  tool inputs, and non-public Google review data.

Advances Definition of Done:
- Satisfies authenticated `/api/chat` persistence and privacy requirements.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 7 as next.

Changelog:
- Add `Added` entries for authenticated chat persistence and `Security` or
  `Changed` entries for privacy-preserving storage behavior.

Commit:
- `Persist authenticated chat turns`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 7: Chat Thread APIs and History UI
Goal: Let signed-in users list, resume, rename, archive, delete, and start chat
threads from the chat experience.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 6

Changes:
- Add `src/app/api/chat/threads/route.ts` for:
  - `GET` listing authenticated user's non-deleted threads newest first;
  - `POST` creating an empty thread with optional title.
- Add `src/app/api/chat/threads/[threadId]/route.ts` for:
  - `GET` returning one owned thread and its messages;
  - `PATCH` updating title, archive status, or soft-delete status;
  - `DELETE` soft-deleting the thread.
- Add tests for `401`, ownership `404`, list ordering, title update, archive,
  soft delete, and message hydration.
- Update `src/features/chat/ChatWorkspace.tsx` or extracted feature components
  to support:
  - anonymous state with no history;
  - signed-in state with no selected thread;
  - selected-thread hydration;
  - new-thread creation without deleting prior history;
  - thread list sorted by `updated_at` or `last_message_at`;
  - rename/archive/delete actions;
  - empty state for first signed-in chat.
- Add or update Playwright tests for signed-in chat persistence after reload and
  opening previous messages from the thread list.

Acceptance Criteria:
- Signed-in users can resume previous chat threads from a different browser
  session using server data.
- Starting a new thread does not delete prior history.
- Anonymous users do not see history UI with private data.
- Cross-user thread access returns `404`.

Advances Definition of Done:
- Satisfies chat history API and frontend requirements.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 8 as next.

Changelog:
- Add `Added` entries for chat thread APIs and history UI.

Commit:
- `Add chat history experience`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 8: Assistant Response Ratings
Goal: Let signed-in users rate assistant responses once and update that rating
later.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 6
- Step 7

Changes:
- Add `src/app/api/chat/ratings/route.ts` with `PUT` validation for:
  - `messageId`;
  - `rating` as `up` or `down`;
  - optional `reasonCodes` from `helpful`, `not_relevant`, `incorrect`,
    `stale`, `unsafe`, `missing_sources`, `too_verbose`, and `other`;
  - optional `comment` capped at 1,000 characters.
- Verify the target message belongs to the authenticated user through its
  thread and has role `assistant`.
- Upsert ratings by `(user_id, message_id)`.
- Return `401` for unauthenticated users and `404` for cross-user messages.
- Reject ratings for user messages.
- Add accessible icon-only thumbs up/down controls to completed assistant
  messages in `ChatWorkspace` or extracted message components.
- Add disabled saving state, selected saved state, rating update behavior, and an
  optional thumbs-down feedback reason/comment flow.
- Add Bun tests for upsert, user-message rejection, cross-user rejection, comment
  length, and reason-code validation.
- Add or update Playwright coverage for rating surviving reload.

Acceptance Criteria:
- A signed-in user can create and update one rating per assistant message.
- User messages cannot be rated.
- Other users' messages are not distinguishable from missing resources.
- Rating UI is keyboard and screen-reader accessible.

Advances Definition of Done:
- Satisfies response rating API and frontend requirements.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 9 as next.

Changelog:
- Add `Added` entries for assistant response ratings.

Commit:
- `Add assistant response ratings`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 9: Authenticated Saved Trips and Migration
Goal: Associate saved trip state with signed-in users while preserving anonymous
saved trips and public share-link privacy.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Update `src/server/trips/shared-trip-store.ts` with owner-aware lookup/listing
  helpers:
  - list saved items by authenticated `user_id`;
  - associate a saved trip with `user_id` during authenticated upsert;
  - migrate an unowned `client_trip_key_hash` row to the current `user_id`;
  - verify item ownership for delete and share creation;
  - preserve anonymous lookup by `client_trip_key_hash`.
- Update `src/app/api/trips/trip-routes.ts`:
  - `GET /api/trips/saved` lists by current Clerk user without requiring
    `tripId` when authenticated;
  - anonymous `GET` still requires and validates `tripId`;
  - authenticated `POST` associates rows with current `user_id`;
  - `DELETE /api/trips/saved/[itemId]` accepts either anonymous trip ownership
    or authenticated ownership;
  - share creation verifies selected items belong to the authenticated user when
    the trip has `user_id`.
- Update `src/server/trips/shared-trip-types.ts` only if request/response DTOs
  need backward-compatible optional fields.
- Update `ChatWorkspace` saved-trip sync code so a signed-in browser can migrate
  the current `ask-siargao:saved-trip:v1` local trip safely.
- Add Bun tests for anonymous compatibility, authenticated listing, migration
  from `local_trip_*`, cross-user delete/share `404` or safe failure, and shared
  token output excluding owner/chat/profile/private data.
- Add or update Playwright coverage for signed-in saved trip persistence if the
  existing UI can exercise it reliably.

Acceptance Criteria:
- Existing anonymous saved-trip behavior still works.
- Signed-in users can retrieve saved items without passing `tripId`.
- Local anonymous saved state migrates to the signed-in user only when unowned or
  already owned by that user.
- Share links remain public token pages that reveal only selected public saved
  artifacts.

Advances Definition of Done:
- Satisfies authenticated saved-trip ownership, migration, and share privacy
  requirements.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 10 as next.

Changelog:
- Add `Changed` entries for authenticated saved-trip ownership and `Security`
  entries for owner checks on delete/share behavior.

Commit:
- `Add authenticated saved trips`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.

### Step 10: Documentation, Privacy Review, and Final Release Gate
Goal: Finish documentation, verify route/privacy behavior end to end, and leave
the implementation ready for review.

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
- Step 9

Changes:
- Update `documentation/developer/reference/routes-and-surfaces.md` with new
  Clerk auth pages, protected profile/chat-history APIs, webhook route, and
  authenticated saved-trip behavior.
- Update
  `documentation/developer/reference/clerk-auth-session-chat-history-requirements.md`
  only if implementation decisions need a short "implemented decision" note, or
  leave it untouched if it remains a source requirements document.
- Review `documentation/developer/reference/environment.md` and `.env.example`
  for final consistency.
- Add a short privacy checklist to the relevant developer docs covering:
  - no persisted exact browser geolocation by default;
  - no raw provider payloads in chat history;
  - no non-public Google review text/author attribution in chat history;
  - shared links do not expose owner, profile, or chat transcript data.
- Run the full release gate and fix regressions.
- Update `PROGRESS.md` and `CHANGELOG.md` with final validation results.

Acceptance Criteria:
- Developer docs match the implemented routes, env vars, and privacy behavior.
- Full validation passes or pre-existing failures are explicitly documented with
  baseline evidence.
- The final repo state satisfies every item in `## Definition of Done`.

Advances Definition of Done:
- Completes documentation, operational readiness, privacy review, and final
  validation.

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
- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status as complete, and no next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with final documentation,
  validation, and privacy-review entries.

Commit:
- `Document Clerk auth rollout`

Step completion sequence:
1. Run all quality gates: `bun run format`, `bun run lint`,
   `bun run typecheck --incremental false`, `bun test`,
   `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and
   `bun run test:e2e`.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit
   reference if available, current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`,
   using the appropriate Keep a Changelog change-type heading.
5. Create a commit for this completed step.
