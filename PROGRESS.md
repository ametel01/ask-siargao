# Map-First Recommendation Cards Progress

## Source Documents

- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`
- `/Users/alexmetelli/source/ask-siargao/PLAN.md`

## Status

- Current step: Step 7 - End-to-End Card Coverage and Release Gates
- State: Step 6 complete
- Next step: Step 7 - End-to-End Card Coverage and Release Gates

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Structured Chat Artifact Contracts
- [x] Step 2: Tool-Backed Card and Action Generation
- [x] Step 3: Places Recommendation Cards
- [x] Step 4: Beach Recommendation Cards
- [x] Step 5: API Response Shape Tests
- [x] Step 6: ChatWorkspace Card Rendering
- [ ] Step 7: End-to-End Card Coverage and Release Gates

## Tracking Rules

- Update this file after every completed step.
- Record the completed step, validation commands and results, commit reference when available,
  current status, and next step.
- Update `CHANGELOG.md` under `## [Unreleased]` after each completed and validated step, before
  creating that step's commit.

## Update Log

### Step 0: Progress and Changelog Tracking Setup

- Status: Complete.
- Changes: Created this progress tracker and verified that `CHANGELOG.md` exists with a Keep a
  Changelog preamble and an `## [Unreleased]` section.
- Validation:
  - `test -f PROGRESS.md` passed.
  - `test -f CHANGELOG.md` passed.
  - `rg -n "Map-First Recommendation Cards|Step 0|Step 1" PROGRESS.md` passed.
  - `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md` passed.
- Commit: `5e5137d` - Track map-first card implementation progress.
- Next step: Step 1 - Structured Chat Artifact Contracts.

### Step 1: Structured Chat Artifact Contracts

- Status: Complete.
- Changes: Replaced the generic recommendation-card placeholder with the roadmap fields for
  place/beach cards and allowed prompt actions to serialize as `id`, `label`, and `prompt`
  without requiring a `type`.
- Validation:
  - `bun test src/server/chat/agent-runtime.test.ts` passed.
  - `bun run format` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed.
- Commit: `e71578e` - Define structured chat card contracts.
- Next step: Step 2 - Tool-Backed Card and Action Generation.

### Step 2: Tool-Backed Card and Action Generation

- Status: Complete.
- Changes: Added optional tool-result cards/actions, merged and de-duplicated them into final
  agent turn results, and passed executed tool results through the Responses tool loop without
  adding raw tool data to audit records.
- Validation:
  - `bun test src/server/chat/agent-runtime.test.ts src/server/chat/ask-siargao-agent.test.ts`
    passed.
  - `bun run format` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed.
- Commit: `b91a4cc` - Attach tool-backed chat artifacts.
- Next step: Step 3 - Places Recommendation Cards.

### Step 3: Places Recommendation Cards

- Status: Complete.
- Changes: Added map-first Google Places cards and prompt actions for search and detail tool
  results, including distance labels, open-status labels, source labels, fit reasons, and caveats
  without fabricating missing map URLs.
- Validation:
  - `bun test src/server/chat/agent-tools.test.ts` passed.
  - `bun run format` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed.
- Commit: `e5d2364` - Generate map-first Places cards.
- Next step: Step 4 - Beach Recommendation Cards.

### Step 4: Beach Recommendation Cards

- Status: Complete.
- Changes: Added curated local-guide beach cards and prompt actions with estimated ride-time
  labels, Google Maps search links, source-backed fit reasons, caveats, and no live open-status
  claims.
- Validation:
  - `bun test src/server/chat/agent-tools.test.ts` passed.
  - `bun run format` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed.
- Commit: `fa4639c` - Generate curated beach cards.
- Next step: Step 5 - API Response Shape Tests.

### Step 5: API Response Shape Tests

- Status: Complete.
- Changes: Added route coverage for structured `cards` and `actions` passthrough, markdown
  message compatibility, optional omission, and `not_verified` card labels without checked tool
  evidence.
- Validation:
  - `bun test src/app/api/chat/route.test.ts` passed.
  - `bun run format` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed.
- Commit: `a0f938f` - Cover structured chat response shape.
- Next step: Step 6 - ChatWorkspace Card Rendering.

### Step 6: ChatWorkspace Card Rendering

- Status: Complete.
- Changes: Rendered recommendation cards and follow-up actions below assistant markdown, parsed
  optional API artifacts into assistant messages, added accessible map links, and wired prompt
  action buttons through the existing chat submit flow.
- Validation:
  - `bun run test:e2e -- tests/e2e/chat.e2e.ts` passed.
  - `bun run format` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed.
  - `npx react-doctor@latest --verbose --scope changed` found no issues; the external score API
    timed out, so no numeric score was available.
- Commit: Pending creation for Step 6.
- Next step: Step 7 - End-to-End Card Coverage and Release Gates.
