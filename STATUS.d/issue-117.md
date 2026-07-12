# Issue 117 - Actionable chat history and saved planning

- issue: #117 Make chat history and saved planning items actionable
- role: builder-agent
- branch: `run/42f7c271-issue-117`
- phase: builder fix-only update complete; ready for checker
- summary:
  - Added `/chat?threadId=...` and `/chat?savedItemId=...` resource selection wiring.
  - Made chat and settings recent-thread rows open exact owned threads, with URL/back-forward
    synchronization, stale-detail guards, and bounded non-enumerating unavailable state.
  - Made settings saved-planning rows open exact saved items; chat focuses/highlights matching saved
    plan items and shows loading/error/not-found states without falling back to the first item.
  - Replaced `window.prompt` thread rename with an in-product Radix dialog, title validation, and
    server-error preservation.
  - Added discoverable selected-thread rename/archive/delete controls; archive/delete clear URL,
    messages, focusable selection, and list state only after server success, with deliberate typed
    delete confirmation.
  - Preserved authenticated saved-trip authority over stale local storage and existing anonymous
    local/authenticated migration behavior.
  - Fix-only update: authenticated empty `/api/trips/saved` responses no longer POST stale
    browser-local saved items back to the server or rewrite local storage, so stale saved item deep
    links settle to `not_found`.
  - Fix-only update: archive now uses an in-product typed `ARCHIVE` confirmation dialog before
    `PATCH`, with Escape cancel focus restoration and Enter-to-confirm coverage.
- evidence:
  - `bun install --frozen-lockfile` passed; no lockfile changes.
  - Focused API/client: `bun test src/app/api/chat/threads/route.test.ts src/features/chat/saved-trip-client.test.ts` passed, 32 tests / 119 assertions.
  - Focused browser: `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "opens and manages exact chat and saved planning selections" --workers=1` passed.
  - Focused settings browser: `bun run test:e2e -- tests/e2e/root.e2e.ts -g "edits profile details" --workers=1` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `npx react-doctor@latest --verbose --scope changed` passed with no issues, score 83/100.
  - `bun test` passed, 987 tests / 5210 assertions.
  - `bun run db:migrate:test && bun run db:seed:test` passed.
  - `bun run build` passed.
  - `bun run test:e2e` passed, 90 tests.
  - `git diff --check` passed.
  - Production `window.prompt`/`window.confirm` scan passed; remaining matches are only the #117
    Playwright guard, plus pre-existing XSS fixture strings.
  - Fix-only focused style/type/client: `bunx biome check src/features/chat/ChatWorkspace.tsx tests/e2e/chat.e2e.ts` passed; `bun run typecheck --incremental false` passed; `bun test src/features/chat/saved-trip-client.test.ts` passed, 17 tests / 43 assertions.
  - Fix-only focused browser: `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "treats authenticated empty saved planning|opens and manages exact chat" --workers=1` passed, 2 tests.
  - Fix-only focused API/client: `bun test src/app/api/chat/threads/route.test.ts src/features/chat/saved-trip-client.test.ts` passed, 32 tests / 119 assertions.
  - Fix-only gates: `bun run lint` passed; `bun run typecheck --incremental false` passed; `git diff --check` passed; `bun test` passed, 987 tests / 5210 assertions; `bun run build` passed; `bun run test:e2e` passed, 91 tests.
- notes:
  - The first full `bun test` and `db:migrate:test` attempts were started concurrently with other
    database-heavy gates and hit PGlite/temporary filesystem contention. Serial reruns passed.
  - Build/E2E emitted the known sibling-lockfile Next workspace-root warning.
  - Full E2E emitted baseline dev-server `DATABASE_URL is required` warnings for unmocked
    background requests; latest fix-only suite passed 91/91.
- checker focus:
  - Verify URL, selected row, messages, title/actions, and list cleanup stay aligned on direct
    navigation, rapid switching, stale 404, archive, and delete.
  - Verify cross-user GET/PATCH/DELETE still return the same 404 shape without mutation.
  - Verify authenticated empty saved trips do not satisfy stale browser-local saved-item links.
  - Verify no public/private saved artifact or chat message leakage was introduced.
