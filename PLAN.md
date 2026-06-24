# Implementation Plan

## Source Documents

- Path: Inline user brief in the current Codex conversation
  - Role: Primary implementation brief
  - Summary: Replace the current `/chat` mockup with a real responsive chat window backed by the existing `/api/chat` endpoint. Keep messages in React state only, support `?prompt=...` auto-submit, remove fake evidence/freshness/trip-context UI, add small internal chat components, and validate with mocked Playwright interaction tests plus repo quality gates.

## Goals

- Replace the mock three-column desktop chat workspace and separate mobile mock with one focused responsive Ask Siargao chat surface.
- Let travelers send messages to the existing `/api/chat` endpoint from the composer and see pending, success, and error states.
- Preserve landing-page `?prompt=...` deep links and auto-submit the initial prompt once.
- Remove mock evidence, fake freshness/confidence badges, fake restaurant cards, fake weather cards, fake trip context, saved places, and recent questions from `/chat`.
- Keep the UI honest that the first slice is a GPT-backed chat response, not live local data or source-backed retrieval.
- Add/update browser tests that mock `/api/chat`, submit a message, verify the assistant response, and verify landing prompt auto-submit.

## Non-Goals

- Do not add database persistence, accounts, trip memory, pass state, usage meters, or chat history storage.
- Do not add streaming responses.
- Do not add weather, Google Places, retrieval tools, source-backed evidence, or fact graph integration.
- Do not change `/api/chat` request/response shape unless the UI cannot be made reliable with the current contract.
- Do not reintroduce the old trip-risk-audit/report framing.
- Do not redesign the landing page beyond keeping its existing chat deep links working.

## Assumptions and Open Questions

- Assumption: The existing uncommitted GPT-backed `/api/chat` slice remains part of the baseline for this work. It includes `src/app/api/chat/**`, `src/server/llm/chat-adapter.ts`, and chat rate limiting. If that work is not committed before execution, Step 0 should record it as pre-existing baseline work in `PROGRESS.md`.
- Assumption: The real chat page should still use the Ask Siargao visual system, dark coastal brand colors, shadcn UI primitives, lucide icons, and the existing `PalmMark`/brand utilities where useful.
- Assumption: The first real chat page can be ephemeral and client-state-only. Reloading `/chat` may clear messages.
- Assumption: Error copy should be user-facing and non-technical, but tests can assert stable text such as "Ask Siargao could not answer right now" or "OpenAI is not configured".
- Open question: Should the desktop chat page keep any lightweight top navigation back to the landing page? Conservative choice: include a compact brand/header link to `/`, but no sidebar.
- Open question: Should suggestion prompts appear in the empty state, above the composer, or both? Conservative choice: show them in the empty state and keep a compact row above the composer while there are messages.

## Quality Gates

- Setup status: Existing gates are configured in `package.json`, `biome.json`, `tsconfig.json`, and `playwright.config.ts`; no quality-gate setup step is required.
- Baseline command: `bun run lint && bun run typecheck && bun test src/app/api/chat/route.test.ts && bun run test:e2e -- tests/e2e/chat.e2e.ts && bun run build`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test src/app/api/chat/route.test.ts`
- Additional gates: `bun run typecheck`, `bun run test:e2e -- tests/e2e/chat.e2e.ts`, `bun run build`

## Progress Tracking

- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.

## Changelog Tracking

- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Verify or create `CHANGELOG.md` before implementation work begins.
- Initial content: The repository already has `# Changelog`, the standard preamble, and an `## [Unreleased]` section. Preserve that structure.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with human-readable notable changes under the appropriate `Unreleased` change-type headings before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup

Goal: Create durable execution tracking and verify release tracking before changing the chat UI.

Changes:
- Create `PROGRESS.md` in the project root.
- Add this plan title, source summary, checklist for all steps, current status, and an update log.
- Record any pre-existing uncommitted GPT chat API work as baseline context if it is still uncommitted when execution starts.
- Verify `CHANGELOG.md` exists and follows Keep a Changelog 1.0.0 structure.
- If `CHANGELOG.md` is missing or malformed, create/fix it with `# Changelog`, the standard preamble, and `## [Unreleased]` with standard change-type headings.

Acceptance criteria:
- `PROGRESS.md` exists and contains the step checklist plus the update rule.
- `CHANGELOG.md` exists, has `# Changelog`, has the Keep a Changelog preamble, and has `## [Unreleased]` at the top.
- No chat behavior changes are made in this step.

Validation:
- Run `test -f PROGRESS.md`
- Run `test -f CHANGELOG.md`
- Run `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set current status to Step 1, and identify Step 1 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress tracking for the real chat replacement plan.

Commit:
- `chore: track real chat replacement progress`

### Step 1: Replace Mock Chat Layout With A Focused Responsive Shell

Goal: Make `/chat` look like a real chat app instead of a desktop mockup with fake sidebars and sample evidence.

Depends on:
- Step 0

Changes:
- Refactor `src/features/chat/ChatWorkspace.tsx`.
- Remove desktop-only three-column layout, `SidebarProvider`, fake left sidebar, fake right context sidebar, fake saved places, fake recent questions, fake trip rows, fake restaurant cards, fake weather cards, fake surf conditions, and mock conversation content.
- Replace the split desktop/mobile structures with one responsive app shell:
  - Compact header with Ask Siargao brand, assistant status, and optional home/new-chat actions.
  - Scrollable message list.
  - Empty state with honest copy and suggested prompts.
  - Sticky composer at the bottom.
- Add small internal components in `ChatWorkspace.tsx`:
  - `ChatMessage`
  - `ChatComposer`
  - `SuggestedPromptBar`
  - `ChatEmptyState`
- Keep existing state shape and `submitPrompt` flow where practical.
- Keep `initialPrompt` support from `src/app/chat/page.tsx`.
- Keep styling aligned with the current Ask Siargao visual system, but avoid fake data indicators.

Acceptance criteria:
- `/chat` renders one responsive chat surface on desktop and mobile.
- No fake "Fresh", "High confidence", mock local source, fake weather, fake trip context, fake saved places, fake recent questions, or mock restaurant evidence appears on `/chat`.
- Empty state clearly invites a real question and does not imply live local data has been checked.
- Suggested prompts submit real messages through the same submit path as the composer.
- Existing `/chat?prompt=...` support remains wired.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun run test:e2e -- tests/e2e/chat.e2e.ts`
- Run `bun run build`
- Fix any failures before proceeding.

Progress:
- Update `PROGRESS.md` with completed Step 1 notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` noting that `/chat` now uses a focused real chat shell instead of the mock sidebar/context layout.

Commit:
- `feat: replace chat mockup with real chat shell`

### Step 2: Add Mocked Browser Coverage For Real Chat Interaction

Goal: Prove the real chat page sends messages to `/api/chat`, renders assistant responses, and handles prompt deep links without spending OpenAI credits in e2e tests.

Depends on:
- Step 1

Changes:
- Update `tests/e2e/chat.e2e.ts`.
- Mock `POST /api/chat` with Playwright `page.route`.
- Add or update desktop coverage:
  - Visit `/chat`.
  - Assert the real chat shell and empty state render.
  - Fill the composer.
  - Click/send the message.
  - Assert the user message renders.
  - Assert pending state appears while the mocked request is in flight if practical.
  - Fulfill the mocked request with a deterministic assistant message.
  - Assert the assistant message renders.
  - Assert the request body contains the submitted user message.
- Add or update mobile coverage:
  - Visit `/chat` at a mobile viewport.
  - Assert the same core chat experience is usable without desktop sidebars.
  - Submit a prompt through the mobile composer or a suggested prompt.
- Add deep-link coverage:
  - Visit `/chat?prompt=What%20should%20I%20do%20near%20Cloud%209%3F`.
  - Mock `/api/chat`.
  - Assert the prompt auto-submits once.
  - Assert the assistant response renders.
- Remove old e2e assertions that require mock sidebars, fake weather, fake trip context, or sample message text.

Acceptance criteria:
- E2E tests fail if `/chat` does not call `/api/chat`.
- E2E tests do not require a real `OPENAI_API_KEY`.
- E2E tests assert absence of old fake layout elements where useful.
- Deep-link auto-submit is covered and does not submit repeatedly on re-render.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun run test:e2e -- tests/e2e/chat.e2e.ts`
- Run `bun run build`
- Fix any failures before proceeding.

Progress:
- Update `PROGRESS.md` with completed Step 2 notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` noting mocked browser coverage for real chat submission and prompt auto-submit.

Commit:
- `test: cover real chat interactions`

### Step 3: Harden Chat Error, Pending, And Accessibility States

Goal: Make the real chat usable and understandable when `/api/chat` is slow, unavailable, or returns an error.

Depends on:
- Step 2

Changes:
- Refine `src/features/chat/ChatWorkspace.tsx` pending and error handling:
  - Disable composer and suggested prompts while a response is in flight.
  - Keep the user's message visible even if the assistant request fails.
  - Replace raw server error strings with concise user-facing copy.
  - Show a retry affordance or make it easy to resend the same prompt, if it can be done without adding persistence.
  - Ensure keyboard submission works with Enter and button activation.
  - Ensure accessible labels describe the composer and send button.
- If `/api/chat` error response shape needs a small compatibility improvement, update `src/app/api/chat/chat-route.ts` and `src/app/api/chat/route.test.ts` narrowly.
- Extend `tests/e2e/chat.e2e.ts` with mocked error coverage:
  - Fulfill `/api/chat` with `503 chat_not_configured` or `502 chat_generation_failed`.
  - Assert the page shows clear user-facing error copy.
  - Assert composer becomes usable again after the failed request.

Acceptance criteria:
- The send controls are disabled during a pending request and re-enabled afterward.
- A failed request shows clear error copy without exposing stack traces, API keys, or low-level OpenAI details.
- A user can continue asking after a failed request.
- The chat remains keyboard usable.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun run test:e2e -- tests/e2e/chat.e2e.ts`
- Run `bun run build`
- Fix any failures before proceeding.

Progress:
- Update `PROGRESS.md` with completed Step 3 notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Fixed` or `Changed` entry under `## [Unreleased]` describing hardened chat pending/error behavior.

Commit:
- `fix: harden chat request states`

### Step 4: Align Landing Deep Links And Final Visual Smoke

Goal: Ensure the landing page still routes users into the real chat experience without implying fake live-data behavior.

Depends on:
- Step 3

Changes:
- Review `src/features/landing/LandingPage.tsx`.
- Keep prompt and suggestion-chip links pointed at `/chat?prompt=...` where appropriate.
- Adjust landing copy only if it currently overclaims that the first chat response uses live local data.
- Update `tests/e2e/root.e2e.ts` if its expectations need to account for prompt deep-link hrefs or changed chat behavior.
- Run a final responsive check for `/chat` at desktop and mobile viewport sizes through Playwright tests.

Acceptance criteria:
- Landing page prompt and chips still navigate into `/chat` with encoded prompts.
- `/chat?prompt=...` auto-submits once and renders the mocked assistant response in e2e.
- No landing or chat copy claims live weather/local provider data is being checked by the first GPT-only slice.
- No horizontal overflow appears on the affected responsive views.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun run test:e2e -- tests/e2e/chat.e2e.ts tests/e2e/root.e2e.ts`
- Run `bun run build`
- Fix any failures before proceeding.

Progress:
- Update `PROGRESS.md` with completed Step 4 notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for aligning landing-to-chat prompt behavior with the real chat surface.

Commit:
- `chore: align landing prompts with real chat`

### Step 5: Final Verification And Handoff

Goal: Confirm the repository is in a working state and summarize exactly what changed.

Depends on:
- Step 4

Changes:
- No feature changes unless validation exposes a defect.
- Review `git diff --stat` and `git status --short`.
- Confirm `PROGRESS.md` and `CHANGELOG.md` are current.
- Optionally run one manual cheap OpenAI smoke test outside e2e only if the user requests it and credits are available. Do not make live OpenAI calls part of CI or Playwright tests.

Acceptance criteria:
- All planned implementation steps are complete.
- The final worktree contains only intended changes.
- `PROGRESS.md` records final validation results and current status.
- `CHANGELOG.md` includes user-readable entries for the completed work.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun run test`
- Run `bun run test:e2e -- tests/e2e/chat.e2e.ts tests/e2e/root.e2e.ts`
- Run `bun run build`
- Run `git diff --check`
- Fix any failures before proceeding.

Progress:
- Update `PROGRESS.md` with final validation results, commit reference if available, and status `Complete`.

Changelog:
- Ensure `CHANGELOG.md` has final `Unreleased` entries under the appropriate headings before committing.

Commit:
- `chore: verify real chat replacement`
