# AI Tool Runtime Progress

Source documents:

- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`

Plan: `/Users/alexmetelli/source/ask-siargao/PLAN.md`

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Agent Runtime Contracts and Test Doubles
- [x] Step 2: Tool Registry and Source Policy Tool
- [ ] Step 3: Weather Forecast Tool
- [ ] Step 4: Google Places Search and Details Tools
- [ ] Step 5: Curated Local Guide Tool
- [ ] Step 6: Responses API Tool Loop Runtime
- [ ] Step 7: Source Consistency Validator
- [ ] Step 8: Rewire `/api/chat` to the Agent Runtime
- [ ] Step 9: Regression, Observability, and Documentation Pass

## Current Status

Step 2 is complete. The backend tool registry and source-policy tool are available, and
Step 3 is next.

## Update Rule

After every completed step, update this file with the completed step, validation results,
commit reference if available, current status, and next step.

`CHANGELOG.md` must also be updated after each step is completed and validated, before
that step is committed.

## Update Log

- 2026-06-26: Completed Step 0 by replacing the previous progress tracker with the AI
  tool runtime step checklist and adding the required changelog tracking entry.
  Validation: confirmed `PROGRESS.md` exists and contains all planned step names;
  confirmed `CHANGELOG.md` contains Keep a Changelog structure with `## [Unreleased]`.
  Commit: this commit (`Add AI tool runtime tracking files`).
  Next step: Step 1, Agent Runtime Contracts and Test Doubles.
- 2026-06-26: Completed Step 1 by adding importable agent runtime contracts, audit and
  source-summary helpers, optional future card/action metadata, and fake Responses/tool
  executor utilities in focused tests.
  Validation: `bun run format` passed; `bun test src/server/chat/agent-runtime.test.ts`
  passed (7 tests); `bun run lint` passed (`biome check .`, 180 files checked);
  `bun run typecheck --incremental false` passed; `bun test` passed (225 tests);
  `bun run db:migrate:test && bun run db:seed:test` passed (38 tables; 5 areas, 3
  routes, 4 source profiles); `bun run build` passed; `bun run test:e2e` passed (17
  tests).
  Commit: this commit (`Define chat agent runtime contracts`).
  Next step: Step 2, Tool Registry and Source Policy Tool.
- 2026-06-26: Completed Step 2 by adding the backend agent tool registry, strict
  Responses-compatible source-policy tool definition, Zod argument validation, dispatcher
  errors for invalid/unknown tools, and machine-readable source-policy output covering all
  current source labels and caveats.
  Validation: `bun run format` passed; `bun test
  src/server/chat/agent-tools.test.ts src/server/chat/agent-runtime.test.ts` passed (12
  tests); `bun run lint` passed (`biome check .`, 182 files checked); `bun run typecheck
  --incremental false` passed; `bun test` passed (230 tests); `bun run db:migrate:test &&
  bun run db:seed:test` passed (38 tables; 5 areas, 3 routes, 4 source profiles); `bun
  run build` passed; `bun run test:e2e` passed (17 tests).
  Commit: this commit (`Add chat agent tool registry`).
  Next step: Step 3, Weather Forecast Tool.
