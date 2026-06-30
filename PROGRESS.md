# Hallmark Audit Redesign Progress

Source plan: `/Users/alexmetelli/source/ask-siargao/PLAN.md`
Source audit: `/Users/alexmetelli/source/ask-siargao/HALLMARK_AUDIT.md`

## Current Status

Step 4 is complete. The landing page now uses a varied trip-planning workbench instead of a stock
equal-card feature grid.

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Baseline Gate And Visual Evidence Capture
- [x] Step 2: Theme Tokens And Shared Primitive Cleanup
- [x] Step 3: Landing Hero, Navigation, And Prompt Workspace
- [x] Step 4: Landing Planning Content And Feature Layout
- [ ] Step 5: App Shell, Report, Chat, And Shared-Trip Surface Cleanup
- [ ] Step 6: Final Hallmark Verification And Release-Gate Pass

## Update Rule

After each completed step, update this file with:

- the completed step;
- validation commands and results;
- commit reference when available;
- current status;
- next step.

## Step Log

### Step 0: Progress and Changelog Tracking Setup

Status: Complete

Changes:

- Created this progress tracker.
- Confirmed `CHANGELOG.md` exists with a Keep a Changelog preamble and an
  `## [Unreleased]` section.
- Added an `Unreleased` changelog entry for Hallmark audit redesign tracking.

Validation:

- `test -f PROGRESS.md`: passed.
- `test -f CHANGELOG.md`: passed.
- `bun run lint`: passed.
- `bun run typecheck --incremental false`: passed.
- `bun test`: passed, 655 tests.
- `bun run db:migrate:test`: passed, 47 tables migrated in the Step 3 test database.
- `bun run db:seed:test`: passed, seeded 5 areas, 3 routes, and 6 source profiles.
- `bun run build`: passed.
- `bun run test:e2e`: failed before tests ran because the local `.env` enables Clerk middleware;
  Playwright's readiness probe timed out on `/robots.txt` after the dev server returned Clerk proxy
  rewrite errors for `http://localhost:3100/robots.txt`.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run
  test:e2e`: passed, 36 tests.
- `bun run doctor`: passed with advisory output, 15 warnings, score 85/100.

Commit:

- `Track Hallmark audit redesign progress`

Next step:

- Step 1: Baseline Gate And Visual Evidence Capture

### Step 1: Baseline Gate And Visual Evidence Capture

Status: Complete

Changes:

- Ran baseline quality gates before visual implementation.
- Captured browser baseline notes for `/`, `/chat`, `/audits/demo/report`, and a shared-trip
  fixture state covered by existing e2e tests.
- Recorded local environment caveats for Clerk-enabled e2e readiness and the database-backed
  shared-trip route.

Baseline command:

- `bun run lint && bun run typecheck --incremental false && bun test`: passed.
  - `bun run lint`: passed.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 655 tests.

Viewport notes:

- `/` at 1366px and 390px: no horizontal overflow. The baseline shows the audited findings:
  five-link SaaS-style nav plus "Open assistant"; H1 text `Ask Siargao anything about your trip.`
  includes one italic/emphasized phrase; class inspection found 7 violet/purple class strings,
  24 white surface/text class strings, and 27 rounded class strings.
- `/chat` at 1366px with a saved-plan localStorage fixture: no horizontal overflow. Saved-plan tray
  rendered with `1 item saved locally, 1 selected to share`; baseline class inspection found 2
  violet/purple class strings, 18 white class strings, 26 rounded class strings, and the `ASK
  SIARGAO` uppercase label.
- `/audits/demo/report` at 1366px: no horizontal overflow. The report rendered `Siargao trip risk
  audit`, `Top risks`, `ev_route`, and `Notes and limitations`; baseline class inspection found 17
  uppercase class strings, 10 white class strings, and 36 rounded class strings.
- Shared-trip fixture state at 1366px, using the existing e2e-style fulfilled
  `/trips/shared/token_baseline` route: rendered `Siargao saved plan - 2 items`, `Shaka Siargao`,
  `Good now`, `Rainy Cloud 9 Afternoon`, `Fallback`, and source caveats.
- Real `/trips/shared/not-real` in this local dev environment returned a 500 due to
  `PostgresError: password authentication failed for user "user"`; route-level Bun tests and e2e
  fulfilled-route coverage passed.

Validation:

- `bun run format`: passed, no fixes applied.
- `bun run lint && bun run typecheck --incremental false && bun test`: passed, 655 tests.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run
  verify:ci`: passed, including lint, clean typecheck, 655 Bun tests, `db:migrate:test`,
  `db:seed:test`, build, and 36 Playwright tests.
- `bun run test:e2e` without overriding local Clerk env remains a local environment caveat:
  Playwright readiness times out because `.env` enables Clerk middleware and `/robots.txt`
  readiness requests hit Clerk proxy rewrite errors.
- `bun run doctor`: passed with advisory output, 15 warnings, score 85/100.

Commit:

- `Record Hallmark redesign baseline`

Next step:

- Step 2: Theme Tokens And Shared Primitive Cleanup

### Step 2: Theme Tokens And Shared Primitive Cleanup

Status: Complete

Changes:

- Added coastal paper, reef, caveat, alert, night-card, border, and shadow tokens in
  `src/theme/global.css`.
- Moved default semantic surfaces away from pure `#ffffff` and shifted primary/ring/CTA globals
  toward lagoon-led values.
- Replaced `transition-all` in `buttonVariants` and `badgeVariants` with explicit transition
  properties.
- Updated the saved-plan tray, assistant dark/error bubbles, shared-trip caveats, and shared app
  shell constants to consume the new semantic tokens.

Acceptance evidence:

- `rg "transition-all" src/components/ui/button-variants.ts src/components/ui/badge-variants.ts`:
  no matches.
- `rg "#ffffff" src/theme/global.css`: no matches.
- `rg "#e4d8b8|#fff9e8|#66521c|border-white/14 bg-white/10|shadow-\\[0_18px_44px_rgba\\(0,0,0,0.14\\)"
  src/features/chat/ChatWorkspace.tsx src/features/trips/SharedTripPlanPage.tsx
  src/ui/components/ask-siargao.tsx`: no matches.

Validation:

- `bun run format`: passed, no fixes applied.
- `bun run lint`: passed.
- `bun run typecheck --incremental false`: passed.
- `bun test`: passed, 655 tests.
- `bun run db:migrate:test`: passed, 47 tables migrated in the Step 3 test database.
- `bun run db:seed:test`: first attempt failed with `ErrnoError errno 20` while I ran it
  concurrently with `db:migrate:test`; sequential rerun passed and seeded 5 areas, 3 routes, and 6
  source profiles.
- `bun run build`: passed.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run
  test:e2e`: passed, 36 tests.
- `bun x react-doctor@latest --verbose --scope changed`: passed, no changed-scope issues, score
  100/100.
- `bun run doctor`: passed with advisory output, 15 warnings, score 85/100.

Commit:

- `Refine coastal theme tokens`

Next step:

- Step 3: Landing Hero, Navigation, And Prompt Workspace

### Step 3: Landing Hero, Navigation, And Prompt Workspace

Status: Complete

Changes:

- Replaced the first-viewport purple/violet hero overlay classes with the coastal overlay token,
  reef-toned gradient, and subtle lagoon/coral atmosphere over the existing Siargao photo.
- Replaced the five-link marketing nav with three compact trip-mode anchors and a `/chat` command
  affordance.
- Removed italic H1 emphasis by replacing the `<em>` trip phrase with roman lagoon text.
- Rewrote touched prompt/copy strings to avoid straight-apostrophe contractions.
- Updated landing e2e assertions for the new desktop chat command and prompt copy.

Viewport evidence:

- Playwright inspection at 390, 768, 1024, and 1366px: no horizontal overflow.
- H1 text remained `Ask Siargao anything about your trip.` and `h1 em/i` count was `0`.
- `/chat` links were present in the first viewport at each inspected width.
- Landing hero class inspection found `0` violet/purple hero classes at each inspected width.

Validation:

- `bun run format`: passed, no fixes applied.
- `bun run lint`: passed.
- `bun run typecheck --incremental false`: passed.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run
  test:e2e -- tests/e2e/root.e2e.ts`: passed, 12 tests.
- `bun test`: passed, 655 tests.
- `bun run db:migrate:test && bun run db:seed:test`: passed.
- `bun run build`: passed.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run
  test:e2e`: passed, 36 tests.
- `bun x react-doctor@latest --verbose --scope changed`: passed, no changed-scope issues, score
  100/100.
- `bun run doctor`: passed with advisory output, 15 warnings, score 85/100.

Commit:

- `Redesign landing first viewport`

Next step:

- Step 4: Landing Planning Content And Feature Layout

### Step 4: Landing Planning Content And Feature Layout

Status: Complete

Changes:

- Replaced the four equal icon-card feature grid with a mixed-span trip-planning workbench covering
  base choice, weather calls, food routing, and transfer realism.
- Reworked the suggestion chips into concrete trip constraints while preserving encoded `/chat`
  prompt links.
- Updated landing e2e assertions for the new prompt labels and workbench headings.

Acceptance evidence:

- `rg "FeatureCards|featureCards|Find the right areas|Weather-aware planning|Try asking about|quiet hotel\\?"
  src/features/landing/LandingPage.tsx tests/e2e/root.e2e.ts`: no matches.
- `rg "CardContent className=\\\"grid grid-cols\\[3\\.75rem_1fr\\]|rounded-full bg-brand-lagoon-100"
  src/features/landing/LandingPage.tsx`: no matches.
- Root Playwright overflow tests passed at 390, 768, 1024, and 1366px.

Validation:

- `bun run format`: passed, fixed formatting in one touched file.
- `bun run lint`: passed.
- `bun run typecheck --incremental false`: passed.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run
  test:e2e -- tests/e2e/root.e2e.ts`: passed, 12 tests.
- `bun test`: passed, 655 tests.
- `bun run build`: passed.
- `bun run db:migrate:test && bun run db:seed:test`: passed.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run
  test:e2e`: passed, 36 tests.
- `bun x react-doctor@latest --verbose --scope changed`: passed, no changed-scope issues, score
  100/100.
- `bun run doctor`: passed with advisory output, 15 warnings, score 85/100.

Commit:

- `Replace generic landing feature grid`

Next step:

- Step 5: App Shell, Report, Chat, And Shared-Trip Surface Cleanup
