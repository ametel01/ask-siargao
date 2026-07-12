# Issue 116 - Privacy and travel-data controls

- issue: #116 Add actionable privacy and travel-data controls
- role: builder-agent
- branch: `run/42f7c271-issue-116`
- phase: maintainer fixes complete at `543533c`; ready for fresh exact-head checker
- summary:
  - Added Clerk-owner-scoped `POST /api/me/privacy` with strict action/confirmation parsing, transactional chat and saved planning bulk deletion, affected share invalidation, repeat-safe responses, and metadata-only audit events.
  - Added stable settings Privacy controls with active-data/exclusions copy, separate profile-backed marketing consent, deliberate confirmation dialogs, location-context clearing, and client cache cleanup only after server success.
  - Updated route documentation, Clerk protected-route inventory, and focused browser/unit coverage for the privacy controls.
- evidence:
  - `bun install --frozen-lockfile` passed.
  - `bun test src/app/api/me/privacy/route.test.ts src/features/chat/saved-trip-client.test.ts src/features/chat/trip-context-draft.test.ts` passed, 24 tests.
  - `bun test src/server/auth/clerk-route-policy.test.ts` passed, 6 tests.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed, 925 tests.
  - `bun run db:migrate:test && bun run db:seed:test` passed.
  - `bun run build` passed.
  - `bun run test:e2e -- tests/e2e/root.e2e.ts -g "manages privacy controls"` passed.
  - `bun run test:e2e -- tests/e2e/root.e2e.ts -g "edits profile details"` passed.
  - `bun run test:e2e` passed, 72 tests.
- notes:
  - No migration was added; privacy audit evidence is sanitized metadata emitted through the existing logger path, not a new durable audit table.
  - Build emitted Next's workspace-root inference warning due sibling worktree lockfiles; build passed.
  - Full E2E emitted baseline dev-server `DATABASE_URL` warnings for unmocked background requests; suite passed.
- checker result:
  - status: ALL GREEN
  - exact head: `90877ac3ac1b33eafcaaccf6009345eb37751e39`
  - semantic evidence:
    - `POST /api/me/privacy` uses strict Zod action/confirmation schemas, rejects extra keys
      including request-body `userId`, derives actor from `ensureCurrentUser`, and is protected by
      `/api/me(.*)` route policy.
    - `deleteOwnedChatHistory` deletes ratings, messages, and active/archived/soft-deleted owned
      threads in one transaction using `chat_threads.user_id = $1`; other users survive in the
      two-user fixture.
    - `deleteOwnedSavedPlanningData` locks owned `saved_trips`, deletes affected
      `shared_trip_plans`, `saved_trip_items`, and `saved_trips` in one transaction; anonymous and
      other-user trips/shares survive, and affected token lookup returns null/generic unavailable.
    - rollback trigger test leaves owned saved trip/item/share intact and records `server_failed`;
      concurrent saved-data requests produce exactly one `success` and one `already_empty`.
    - audit events contain only action, actor ref/anonymous, request ID, timestamp, outcome, and
      coarse counts; tests assert absence of message text, confirmation phrase, share token, payload
      text, profile text, and coordinates.
    - location clear rejects unknown keys, removes only `currentArea` and `accommodation`, preserves
      unrelated trip context/profile fields and `marketingConsent`, and browser local cleanup happens
      only after server success.
    - settings copy names active data/exclusions, distinguishes one-request/trip-session/stored
      location use, states exact-coordinate non-retention, and makes no account-closure or unsupported
      retention/purge-duration promise.
    - UI uses in-product `role="dialog"` confirmations, action-specific phrases, disabled pending
      submit, focus return, and distinct success/already-empty/auth/validation/server/network text.
  - commands:
    - `bun install --frozen-lockfile`: PASS, no changes; local Bun `1.3.14`, CI pins `1.3.13`.
    - `bun test src/app/api/me/privacy/route.test.ts src/app/api/me/profile/route.test.ts src/server/auth/clerk-route-policy.test.ts src/server/trips/shared-trip-store.test.ts src/server/trips/shared-trip-types.test.ts src/features/chat/saved-trip-client.test.ts src/features/chat/trip-context-draft.test.ts src/features/settings/account-identity.test.ts src/features/settings/account-management.test.ts src/features/settings/profile-options.test.ts`: PASS, 85 tests / 485 assertions.
    - `bun run test:e2e -- tests/e2e/root.e2e.ts -g "manages privacy controls|edits profile details"`: PASS, 2 tests.
    - ad hoc Playwright probe against `http://127.0.0.1:3101`: PASS,
      `AD_HOC_PRIVACY_UI_PASS pending/auth/validation/network/focus/mobile390/desktop1280`.
    - `bun run lint`: PASS, Biome checked 333 files.
    - `bun run typecheck --incremental false`: PASS.
    - `bun test`: PASS, 925 tests / 4968 assertions.
    - `bun run db:migrate:test`: PASS, 50 tables / 8 migrations.
    - `bun run db:seed:test`: PASS, 5 areas / 3 routes / 6 source profiles.
    - `bun run build`: PASS.
    - `bun run test:e2e`: PASS, 72 tests.
    - `git diff --check origin/main...HEAD`: PASS.
    - `git diff --name-only origin/main...HEAD -- package.json bun.lock .github/workflows`: PASS,
      no dependency/lock/workflow diff.
    - diff secret-pattern scan for private keys, live/test Stripe keys, GitHub tokens, Google API
      keys, and named secret assignments: PASS, no matches.
  - exact-head Actions:
    - CI run `29186962443` / job `86634734149`: PASS at head
      `90877ac3ac1b33eafcaaccf6009345eb37751e39`; install, Playwright browser install, lint,
      typecheck, Bun tests, DB migrate, DB seed, build, E2E, and both screenshot uploads succeeded
      in 8m16s.
    - React Doctor run `29186962427`: PASS.
    - GitGuardian Security Checks, Socket Security PR Alerts, Socket Project Report, CodeRabbit, and
      React Doctor status: PASS.
  - PR context:
    - PR #134 is open draft, merge state `CLEAN`, author `ametel01`, head
      `90877ac3ac1b33eafcaaccf6009345eb37751e39`.
    - live `closingIssuesReferences` is exactly `{#116}`.
  - baseline warnings:
    - Build and Playwright dev server emit Next workspace-root inference warnings because sibling
      worktree lockfiles exist; build/E2E passed.
    - Full E2E emits baseline dev-server `DATABASE_URL is required` warnings for unmocked background
      profile/saved-trip requests; suite passed 72/72.
    - GitHub Actions annotation: Node.js 20 deprecation warning for pinned `actions/upload-artifact`;
      CI job passed.
  - failures: none.
  - coverage gaps:
    - No blocking semantic gap found. Residual note: committed Playwright coverage exercises privacy
      server failure/success/already-empty/local cleanup, while auth/validation/network UI branches
      were verified by ad hoc read-only Playwright probe rather than a persisted regression test.
  - builder fix handoff:
    - fix commit: `543533c` (`Fix privacy control review findings`), code/tests only; status update remains separate.
    - request-id finding: privacy audit correlation IDs now always come from the server-generated
      dependency value; `x-request-id` is ignored, and a regression proves message text, share-token
      text, coordinates, and confirmation text cannot enter audit metadata.
    - modal finding: destructive confirmations render through a body-ported native `dialog` opened by
      `showModal()`, explicitly inert/aria-hide every background body child, trap Tab/Shift+Tab, block
      Escape while pending, and restore focus after committed close.
    - UI coverage finding: committed Playwright coverage now exercises auth/401, validation/400,
      network abort, pending/disabled/Escape, focus containment/background inaccessibility, focus
      return, and 390px/1280px layouts; focused privacy E2E is 2/2.
    - post-fix gates: `bun run lint`, clean typecheck, focused route/unit 31 tests / 186 assertions,
      focused privacy E2E 2/2, and prior full gates remain green: Bun 926/4974, DB migrate/seed,
      build, full E2E 73/73. React Doctor no longer reports `prefer-html-dialog` for the changed
      dialog; its remaining overall warnings are unrelated pre-existing settings diagnostics.
  - next action: fresh exact-head checker should verify `543533c` plus this status handoff, then route
    to independent maintainer re-review; do not merge from builder lane.
