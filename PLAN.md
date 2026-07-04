# Implementation Plan

## Source Documents
- Path: `/Users/alexmetelli/source/ask-siargao/documentation/developer/reference/routes-and-surfaces.md`
  - Role: Primary route, API, indexing, and authenticated-data boundary reference.
  - Summary: The app currently exposes `/profile` as a private authenticated profile-settings
    surface; `/api/me/profile`, `/api/chat/threads`, `/api/chat/ratings`, and authenticated
    saved-trip reads are Clerk-authenticated owner-scoped APIs. The document requires authenticated
    data surfaces to derive ownership from Clerk auth, keep anonymous chat public, keep public shared
    trip links noindex and privacy-filtered, and avoid exposing full chat transcripts, owner IDs,
    profile details, exact geolocation, raw provider payloads, private source observations, Google
    review text/author data, secret tokens, or exact coordinates.

## Goals
- Add a canonical `/settings` route for signed-in user settings.
- Turn the existing profile-only settings surface into a broader settings dashboard without losing
  the existing travel-profile editing behavior.
- Preserve `/profile` compatibility for existing links and tests while steering in-app navigation to
  `/settings`.
- Keep all private data reads owner-scoped through Clerk-authenticated APIs and route protection.
- Update route documentation and tests so `/settings` is treated as a private authenticated surface.

## Non-Goals
- Do not build a custom Clerk account, password, session, email, or identity-management flow.
- Do not add billing, Stripe portal, trip-pass checkout, or trip-pass usage management in this slice.
- Do not add all-saved-trips management, saved-trip bulk editing, data export, data deletion, or
  account deletion flows.
- Do not change public shared-trip behavior, public chat availability, public knowledge surfaces, or
  existing API privacy contracts except where documentation must mention `/settings`.
- Do not add database migrations unless implementation discovers an unavoidable missing column for
  the bounded dashboard. The intended implementation reuses existing tables and APIs.

## Definition of Done
- `/settings` exists as a Next.js App Router page and renders a signed-in settings dashboard.
- `/profile` remains usable as a compatibility alias by rendering the same dashboard or redirecting
  to `/settings`; choose one behavior and update tests/docs accordingly.
- Clerk route policy protects `/settings(.*)` and continues protecting `/profile(.*)`,
  `/api/me(.*)`, `/api/chat/threads(.*)`, and `/api/chat/ratings(.*)`.
- The settings dashboard includes:
  - Account identity and Clerk `UserButton` account-management entry point.
  - Existing Ask Siargao travel-profile form backed by `/api/me/profile`.
  - A lightweight chat-history summary using `/api/chat/threads` without loading full messages.
  - A lightweight saved-plan summary using `/api/trips/saved` without exposing raw provider payloads,
    exact geolocation, owner IDs, or full chat transcripts.
  - Clear empty, loading, signed-out, and unavailable states.
- In-app links that currently send users to `/profile` for settings or saved places are updated to
  `/settings`, while `/profile` still works for direct visits.
- `documentation/developer/reference/routes-and-surfaces.md` lists `/settings` as the canonical
  private settings dashboard and documents `/profile` as a legacy alias or compatibility surface.
- Route policy unit tests, profile/settings API or component tests, and Playwright coverage are
  updated for the new route behavior.
- `PROGRESS.md` and `CHANGELOG.md` are current. `CHANGELOG.md` includes only functional shipped
  behavior under `## [Unreleased]`.
- Required quality gates pass, or any pre-existing failure is documented in `PROGRESS.md` with exact
  command output summary and next action.

## Assumptions and Open Questions
- Assumption: The user request for a "new route and dashboard for user settings" means `/settings`
  should become the canonical user-facing route, while `/profile` remains compatible because the
  source document currently defines `/profile` as the private settings surface. If `/profile` should
  be removed instead, stop before implementation and confirm the breaking route change.
- Assumption: The first dashboard should summarize existing account, profile, chat-thread, and saved
  plan data. Billing/trip-pass settings are intentionally deferred because the route reference does
  not define a billing/account API contract and current trip-pass helpers do not expose a
  current-user read surface.
- Assumption: The dashboard can fetch existing endpoint data client-side with SWR, matching the
  current `ProfileSettingsPage` pattern.
- Open question: Whether `/profile` should render the same dashboard or issue a server redirect to
  `/settings`. Recommended answer: render the same dashboard initially to reduce redirect churn and
  preserve current E2E assumptions, then optionally redirect in a later cleanup.

## Implementation Approach
- Reuse the current profile settings implementation instead of creating a separate data model. The
  current `src/features/profile/ProfileSettingsPage.tsx` already loads `/api/me/profile`, edits
  Ask Siargao-owned travel preferences, and delegates identity management to Clerk.
- Introduce a settings-named feature surface while keeping the existing profile export as a
  compatibility wrapper:
  - Preferred structure:
    - `src/features/settings/SettingsDashboardPage.tsx`
    - `src/features/profile/ProfileSettingsPage.tsx` re-exports or wraps
      `SettingsDashboardPage` temporarily.
    - `src/app/settings/page.tsx` renders `SettingsDashboardPage`.
    - `src/app/profile/page.tsx` renders `SettingsDashboardPage` or redirects to `/settings`.
- Keep data boundaries shallow:
  - Use `/api/me/profile` for identity and profile details.
  - Use `/api/chat/threads` only for thread summaries; do not call
    `/api/chat/threads/[threadId]` from the settings dashboard.
  - Use `/api/trips/saved` only for the current signed-in user's latest saved-plan summary.
  - Do not add a new aggregate `/api/me/settings` endpoint unless repeated fetch/error handling
    becomes materially simpler. If one is added, it must call the same owner-scoped store functions
    and must have route tests for unauthenticated access and cross-user isolation.
- Keep Clerk as source of truth for account identity and security. The dashboard may display identity
  fields from `/api/me/profile` and show `UserButton`, but must not PATCH Clerk-owned fields through
  `/api/me/profile`.
- Keep UI consistent with existing app shell primitives in `src/ui/components/ask-siargao.tsx`,
  existing shadcn-style primitives under `src/components/ui`, and current chat/profile design.
- Preserve privacy constraints from the source document: no full chat transcripts, raw tool calls,
  raw provider payloads, private source observations, exact coordinates, owner IDs, profile data in
  public links, Google review text/author data, or secret tokens.

## Quality Gates
- Setup status: Existing gates found in `package.json`, `biome.json`, `tsconfig.json`,
  `playwright.config.ts`, and GitHub Actions. No quality-gate setup step is required.
- Baseline command: `bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates:
  - Typecheck: `bun run typecheck --incremental false`
  - Test database migration: `bun run db:migrate:test`
  - Test database seed: `bun run db:seed:test`
  - Build: `bun run build`
  - E2E: `bun run test:e2e`
  - Full CI-equivalent: `bun run verify:ci`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step,
  validation results, commit reference if available, current status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Ensure `CHANGELOG.md` exists before any quality-gate setup or implementation work
  begins. This repository already has `CHANGELOG.md`; preserve existing entries.
- Initial content: If missing, create `# Changelog`, the standard preamble, and an
  `## [Unreleased]` section. If present, verify that structure before implementation.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` before creating
  that step's commit only if the step shipped a functional change. Omit entries for chores,
  progress tracking, implementation plans, docs-only updates, tests or coverage, CI or validation
  runs, framework migration housekeeping, and empty category headings.

## Goal Handoff
- Readiness: This plan is ready to be used as a `/goal` payload.
- Scope: The `/goal` should execute only the work described in this plan unless the user explicitly
  expands it.
- Done: The `/goal` is complete only when every item in `## Definition of Done` is satisfied, all
  incremental steps are complete, required quality gates pass or documented pre-existing failures
  are handled, `PROGRESS.md` and `CHANGELOG.md` are current, and the final state is summarized for
  the user.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress tracking and verify changelog tracking before implementation begins.

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title, source document path, current git commit, a checklist for Steps 0-5, current
  status, and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Verify that `CHANGELOG.md` exists in the project root and follows Keep a Changelog 1.0.0
  structure with `# Changelog`, the standard preamble, and `## [Unreleased]`.
- If `CHANGELOG.md` is missing, create it before implementation starts. If it exists, preserve all
  existing content.

Validation:
- Confirm `PROGRESS.md` exists and contains the step checklist.
- Confirm `CHANGELOG.md` exists and includes `# Changelog` and `## [Unreleased]`.
- Run baseline gates before feature implementation when practical:
  `bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test`

Acceptance criteria:
- The repository has durable progress tracking.
- The existing changelog is preserved and ready for functional entries.
- Any baseline failure is documented in `PROGRESS.md` before implementation proceeds.

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set current status to Step 1,
  and identify the next step.

Changelog:
- Do not add a changelog entry for progress and changelog tracking setup because it is not a
  functional change.

Commit:
- `Initialize settings dashboard progress tracking`

### Step 1: Protect And Expose The Canonical Settings Route
Goal: Make `/settings` a real private application route without breaking `/profile`.

Depends on:
- Step 0

Changes:
- Add `src/app/settings/page.tsx`.
- Create or move the reusable dashboard entry point to `src/features/settings/SettingsDashboardPage.tsx`.
  Initially it may render the existing profile settings UI so `/settings` becomes functional before
  dashboard expansion.
- Update `src/app/profile/page.tsx` to render the same dashboard component or intentionally redirect
  to `/settings`. Prefer rendering the same component unless the implementer confirms redirects will
  not break current tests or expected links.
- Update `src/server/auth/clerk-route-policy.ts`:
  - Add `"/settings(.*)"` to `clerkProtectedRoutePatterns`.
  - Add `/^\/settings(?:\/.*)?$/` to `protectedRouteExpressions`.
  - Keep existing `/profile(.*)` protection.
- Update `src/server/auth/clerk-route-policy.test.ts`:
  - Assert `/settings` and `/settings/profile` classify as `protected`.
  - Assert similarly named routes such as `/settings-public` remain `public-by-default`.
- Do not change public route patterns for `/chat`, `/api/chat`, `/api/trips/share`, public knowledge
  routes, Clerk webhooks, or Stripe webhooks.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/auth/clerk-route-policy.test.ts`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Acceptance criteria:
- `/settings` resolves to a settings page.
- `/profile` still resolves to a usable settings/profile page or a documented redirect.
- Route classification protects both `/settings` and `/profile`.
- No public route from the source document is accidentally protected.

Definition of Done advancement:
- Establishes the new route contract and security boundary required for the dashboard.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for the new authenticated `/settings` route.

Commit:
- `Add protected settings route`

### Step 2: Build The Settings Dashboard Shell Around Existing Profile Editing
Goal: Replace the profile-only page shape with a settings dashboard while preserving travel-profile
editing behavior.

Depends on:
- Step 0
- Step 1

Changes:
- In `src/features/settings/SettingsDashboardPage.tsx`, build a dashboard layout using existing app
  shell primitives from `src/ui/components/ask-siargao.tsx` and UI primitives from
  `src/components/ui`.
- Preserve the current profile form fields and PATCH behavior from
  `src/features/profile/ProfileSettingsPage.tsx`:
  - Display name.
  - Home country.
  - Travel style.
  - Budget level.
  - Interests.
  - Preferred areas.
  - Dietary notes.
  - Accessibility notes.
  - Trip notes stored in `tripContext.notes`.
  - Marketing consent.
- Keep `/api/me/profile` as the profile data source and keep `profilePatchFromForm` semantics:
  comma-separated interests/preferred areas become string arrays; blank optional text becomes
  `null`; blank trip notes become `{}`.
- Add dashboard sections:
  - Account: identity summary from `profile.identity` and Clerk `UserButton`.
  - Travel profile: current editable form.
  - Privacy: concise private-data boundary text consistent with the route reference.
  - Shortcuts: links to `/chat` and any saved/chat panels added in Step 3.
- Keep signed-out behavior:
  - If Clerk is configured, show Clerk modal sign-in/sign-up actions.
  - If Clerk is not configured, preserve links to `/sign-in` and `/sign-up`.
- Keep loading and unavailable states stable and non-overlapping on mobile and desktop.
- Keep `src/features/profile/ProfileSettingsPage.tsx` as a compatibility export or small wrapper so
  existing imports do not break until all references move.

Tests:
- Update existing Playwright profile test in `tests/e2e/root.e2e.ts` to visit `/settings` and assert
  the dashboard heading plus the persisted profile-editing behavior.
- Add or update component/route tests only where local test patterns already exist. Do not introduce
  a new frontend test framework.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/app/api/me/profile/route.test.ts`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Acceptance criteria:
- A signed-in user can edit the same profile fields from `/settings`.
- Save success and save failure states still work.
- The dashboard does not allow PATCHing Clerk-owned identity fields.
- Signed-out users see an appropriate sign-in state.
- Mobile and desktop layouts do not have incoherent overlapping UI.

Definition of Done advancement:
- Provides the main user-visible dashboard surface while preserving existing settings behavior.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` describing the profile settings page becoming a
  settings dashboard only if the dashboard shell is user-visible in this step.

Commit:
- `Build settings dashboard shell`

### Step 3: Add Private Chat And Saved-Plan Summary Panels
Goal: Surface useful owned-data summaries in settings without expanding private data exposure.

Depends on:
- Step 0
- Step 1
- Step 2

Changes:
- Add a chat-history summary panel in `SettingsDashboardPage`:
  - Fetch `/api/chat/threads` with SWR when the user is authenticated.
  - Show a count and the latest few thread titles/timestamps.
  - Link users back to `/chat`.
  - Do not fetch `/api/chat/threads/[threadId]` or render full message content.
  - Treat `401` as signed-out and other failures as a non-blocking unavailable state.
- Add a saved-plan summary panel:
  - Fetch `/api/trips/saved` with SWR when the user is authenticated.
  - Show the latest saved trip item count and a few item titles/kinds.
  - Link users back to `/chat` to continue saving or sharing.
  - Do not render raw payload internals beyond existing safe item title/kind/source-summary shaped
    fields already returned for saved items.
- If the dashboard needs repeated fetch error handling, extract a small typed fetch helper local to
  the settings feature. Do not add a new aggregate API unless the implementation becomes
  substantially simpler and still preserves owner-scoped checks.
- If adding a new aggregate API becomes necessary:
  - Add it under `/api/me/settings`.
  - Protect it through existing `/api/me(.*)` policy.
  - Implement route tests for unauthenticated access and current-user-only data.
  - Do not include full transcripts, raw provider payloads, exact geolocation, owner IDs, private
    source observations, Google review text/author data, or secret tokens.

Tests:
- Add Playwright route mocks for `/api/chat/threads` and `/api/trips/saved` in the settings E2E
  test and assert summary counts/titles render.
- Add a failure-state assertion for one summary panel if practical.
- If `/api/me/settings` is added, add Bun route tests beside the route.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/app/api/chat/threads/route.test.ts`.
- Run `bun test src/app/api/trips/route.test.ts`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Acceptance criteria:
- Settings shows useful owned chat and saved-plan summaries.
- The dashboard never renders full chat transcripts, exact browser coordinates, raw provider
  payloads, private source observations, Google review text/author data, owner IDs, or secret
  tokens.
- Summary-panel failures do not prevent the profile form from loading or saving.

Definition of Done advancement:
- Makes the dashboard broader than profile editing while respecting authenticated-data privacy
  requirements from the source document.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for chat and saved-plan summaries in settings.

Commit:
- `Add settings data summaries`

### Step 4: Update In-App Navigation And Route Documentation
Goal: Make `/settings` the documented and navigable settings surface while preserving legacy access.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3

Changes:
- Update settings-related links in `src/features/chat/ChatWorkspace.tsx` from `/profile` to
  `/settings`, including the saved-places/settings entry points currently pointing at `/profile`.
- Leave any intentionally profile-specific compatibility link only if the UI label explicitly says
  profile and the destination remains `/profile`.
- Update `documentation/developer/reference/routes-and-surfaces.md`:
  - Add `/settings` as the canonical signed-in user settings dashboard.
  - Keep `/profile` documented as a compatibility alias or legacy route if retained.
  - Confirm Auth APIs section still documents `/api/me/profile`.
  - Confirm Authenticated Data Privacy Checklist still covers settings dashboard behavior.
- If `documentation/developer/reference/clerk-auth-session-chat-history-requirements.md` is still
  maintained as an implementation reference, add a small note that `/settings` supersedes `/profile`
  as the user-facing settings route while `/profile` remains compatible.

Tests:
- Update Playwright assertions that inspect links to expect `/settings` for settings/saved-place
  navigation.
- Keep one direct `/profile` compatibility assertion if `/profile` renders or redirects.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/auth/clerk-route-policy.test.ts`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Acceptance criteria:
- Primary in-app navigation points to `/settings`.
- Route documentation matches implemented behavior.
- Existing `/profile` compatibility behavior is documented and tested.

Definition of Done advancement:
- Aligns user-facing navigation and durable docs with the new canonical route.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` only if the primary navigation change is
  user-visible in this step.

Commit:
- `Document settings route and update navigation`

### Step 5: Final Verification And Cleanup
Goal: Prove the complete settings-dashboard slice is ready to hand back.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Remove any dead imports, obsolete wrapper code, duplicated type definitions, or stale test mocks
  introduced during implementation.
- Confirm `src/features/profile/ProfileSettingsPage.tsx` is either a deliberate compatibility
  wrapper or removed only after all imports/tests are updated.
- Confirm no unrelated `STATUS.md`, docs, generated files, or user-owned changes were swept into
  the implementation.
- Confirm `CHANGELOG.md` has only functional entries and no empty category headings.
- Confirm `PROGRESS.md` records every completed step and final validation results.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- Prefer also running `bun run verify:ci` if time and local services permit.

Acceptance criteria:
- Full gate list passes or any pre-existing/environmental failure is documented with exact command
  and concise failure summary.
- The final diff is scoped to the settings route/dashboard, tests, route docs, progress tracking,
  and changelog entries.
- The final user summary can state the route behavior, dashboard capabilities, validation commands,
  and any residual risks without relying on unstated context.

Definition of Done advancement:
- Completes validation, cleanup, and handoff requirements.

Progress:
- Update `PROGRESS.md` with final validation results, current status `Complete`, and no remaining
  next implementation step.

Changelog:
- Do not add a changelog entry for final verification unless a functional fix ships during cleanup.

Commit:
- `Verify settings dashboard implementation`
