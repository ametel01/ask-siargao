# Consent-Based Near-Me Geolocation Progress

## Source Documents

- `docs/ASK_SIARGAO_ROADMAP.md`
- `docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
- `docs/ASK_SIARGAO_POSITIONING.md`

## Tracking Rule

Update this file after every completed implementation step with validation results, commit
references, current status, and the next step.

## Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Chat Client Context Schema and Geolocation Validation
- [x] Step 2: Geolocated Places Center Selection and Privacy-Safe Tool Policy
- [x] Step 3: Chat UI Location Consent Control
- [ ] Step 4: Answer Metadata, Caveats, and Source Consistency for Location Source
- [ ] Step 5: End-to-End Permission Coverage and Final Documentation

## Current Status

Step 3 complete. Current status: Step 4 ready to start.

## Update Log

### 2026-06-27 - Step 0

- Created implementation progress tracking for the Priority 10 consent-based near-me geolocation
  slice.
- Confirmed `CHANGELOG.md` exists with `# Changelog`, Keep a Changelog preamble, and an
  `## [Unreleased]` section.
- Validation:
  - `test -f PROGRESS.md`: passed
  - `test -f CHANGELOG.md`: passed
  - `rg -n "^## \\[Unreleased\\]" CHANGELOG.md`: passed (`CHANGELOG.md:8`)
  - `bun run lint`: passed
- Commit: `3c66d68` (`Track near-me geolocation implementation progress`)
- Next step: Step 1, chat client context schema and geolocation validation.

### 2026-06-27 - Step 1

- Added optional `/api/chat` `clientContext.geolocation` schema validation for browser
  geolocation coordinates, accuracy, capture time, and consent scope.
- Normalized browser geolocation into deterministic agent signals with `available`, `missing`,
  `out_of_area`, `stale`, and `low_accuracy` states.
- Passed only usable Siargao-area coordinates to the agent context and kept route metadata/logs
  limited to validation status, source, and consent scope.
- Validation:
  - `bun run format`: passed
  - `bun run lint`: passed
  - `bun run typecheck --incremental false`: passed
  - `bun test src/app/api/chat/route.test.ts`: passed
  - `bun test`: passed
- Commit: `1a31072` (`Validate chat geolocation context`)
- Next step: Step 2, geolocated Places center selection and privacy-safe tool policy.

### 2026-06-27 - Step 2

- Repaired near-me `search_places` tool calls to use available consented browser geolocation as
  the search center even when the model supplies a stale/default center.
- Added backend-owned Places tool context for center source, consent scope, and no-store cache
  mode without changing the strict model-call schema.
- Exposed browser-geolocation center source in Places tool data and caveats without displaying raw
  coordinates in user-facing metadata.
- Bypassed Google Places chat cache reads and writes for no-store browser-location searches so
  exact single-request coordinates are not persisted.
- Validation:
  - `bun run format`: passed
  - `bun run lint`: passed
  - `bun run typecheck --incremental false`: passed
  - `bun test src/server/chat/agent-tools.test.ts src/server/chat/ask-siargao-agent.test.ts`:
    passed
  - `bun test src/server/providers/google-places-chat-cache.test.ts`: passed
  - `bun test src/app/api/chat/route.test.ts`: passed
  - `bun test`: passed
- Commit: `afe727d` (`Use consented geolocation for nearby Places`)
- Next step: Step 3, chat UI location consent control.

### 2026-06-27 - Step 3

- Added a compact optional location control to the chat composer using the existing icon-button
  pattern.
- Requested browser geolocation only after an explicit traveler click and sent
  `clientContext.geolocation` with the next chat request when a captured location is ready.
- Kept location consent scoped to `single_request` and consumed the captured location after the
  request was sent, without local storage or server-side persistence changes.
- Added concise UI states for optional, requesting, ready, denied, unavailable, unsupported, and
  consumed location states without showing raw coordinates.
- Added Playwright coverage for the mocked geolocation path and single-request consumption.
- Validation:
  - `bun run format`: passed
  - `bun run lint`: passed
  - `bun run typecheck --incremental false`: passed
  - `bun test src/app/api/chat/route.test.ts`: passed
  - `bun run test:e2e -- tests/e2e/chat.e2e.ts --project=chromium`: passed
  - `bun test`: passed
  - `npx react-doctor@latest --verbose --scope changed`: passed, score 100/100
- Commit: pending
- Next step: Step 4, answer metadata, caveats, and source consistency for location source.
