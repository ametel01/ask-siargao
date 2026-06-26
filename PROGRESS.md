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
- [x] Step 3: Weather Forecast Tool
- [x] Step 4: Google Places Search and Details Tools
- [x] Step 5: Curated Local Guide Tool
- [x] Step 6: Responses API Tool Loop Runtime
- [ ] Step 7: Source Consistency Validator
- [ ] Step 8: Rewire `/api/chat` to the Agent Runtime
- [ ] Step 9: Regression, Observability, and Documentation Pass

## Current Status

Step 6 is complete. The Responses API tool-loop runtime is available, and Step 7 is next.

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
- 2026-06-26: Completed Step 3 by adding the `get_weather_forecast` agent tool with
  strict known-location/date-range arguments, Open-Meteo snapshot loading, Del Carmen and
  General Luna/Cloud 9 forecast-location routing, normalized weather signals, live/fallback
  source summaries, and provider-unavailable tool outputs for fallback or provider failure
  cases.
  Validation: `bun run format` passed; `bun test
  src/server/chat/agent-tools.test.ts src/server/providers/open-meteo.test.ts
  src/server/public-pages/weather-snapshot.test.ts` passed (20 tests); `bun run lint`
  passed (`biome check .`, 182 files checked); `bun run typecheck --incremental false`
  passed; `bun test` passed (236 tests); `bun run db:migrate:test && bun run
  db:seed:test` passed (38 tables; 5 areas, 3 routes, 4 source profiles); `bun run build`
  passed; `bun run test:e2e` passed (17 tests).
  Commit: this commit (`Add weather forecast chat tool`).
  Next step: Step 4, Google Places Search and Details Tools.
- 2026-06-26: Completed Step 4 by adding `search_places` and `get_place_details` agent
  tools with strict argument validation, cached Google Places chat search reuse, live
  fallback search through the governed chat field mask, cache-first place details, live
  details fallback through the allowed details field mask, restricted output shaping, and
  provider-unavailable tool outputs for search/detail failures.
  Validation: `bun run format` passed; `bun test
  src/server/chat/agent-tools.test.ts src/server/providers/google-places-policy.test.ts
  src/server/providers/google-places-chat.test.ts
  src/server/providers/google-places-chat-cache.test.ts
  src/server/providers/google-places-store.test.ts
  src/server/providers/google-places-enrichment.test.ts
  src/server/providers/google-places-discovery.test.ts` passed (44 tests); `bun run lint`
  passed (`biome check .`, 182 files checked); `bun run typecheck --incremental false`
  passed; `bun test` passed (244 tests); `bun run db:migrate:test && bun run
  db:seed:test` passed (38 tables; 5 areas, 3 routes, 4 source profiles); `bun run build`
  passed; `bun run test:e2e` passed (17 tests).
  Commit: this commit (`Add governed Places chat tools`).
  Next step: Step 5, Curated Local Guide Tool.
- 2026-06-26: Completed Step 5 by adding structured local guide search output for the
  curated Siargao beach data, keeping the legacy prose renderer for route compatibility,
  and exposing `search_local_guide` with filters for beach surface, swimming, sunset, rain
  fit, origin, ride time, transport mode, and kids constraints. The tool returns curated
  source summaries plus caveats for tide, currents, live road conditions, access changes,
  and lifeguard/safety status.
  Validation: `bun run format` passed; `bun test
  src/server/chat/agent-tools.test.ts src/app/api/chat/route.test.ts
  src/server/chat/local-recommendation.test.ts` passed (59 tests); `bun run lint` passed
  (`biome check .`, 182 files checked); `bun run typecheck --incremental false` passed;
  `bun test` passed (248 tests); `bun run db:migrate:test && bun run db:seed:test` passed
  (38 tables; 5 areas, 3 routes, 4 source profiles); `bun run build` passed; `bun run
  test:e2e` passed (17 tests).
  Commit: this commit (`Add curated local guide chat tool`).
  Next step: Step 6, Responses API Tool Loop Runtime.
- 2026-06-26: Completed Step 6 by adding the `runAskSiargaoAgentTurn` Responses API
  runtime, `store: false` model calls with typed tool definitions, tool-result feedback,
  upstream request ID tracking, source aggregation, structured tool-call audits, provider
  operation logging, and max tool-call/turn protections. Network-free tests cover no-tool
  answers, weather, Places search/details, curated local guide, multiple tool calls,
  provider-failure continuation, loop protection, and missing-output failures.
  Validation: `bun run format` passed; `bun test
  src/server/chat/ask-siargao-agent.test.ts src/server/chat/agent-tools.test.ts
  src/server/chat/agent-runtime.test.ts` passed (38 tests); `bun run lint` passed (`biome
  check .`, 184 files checked); `bun run typecheck --incremental false` passed; `bun test`
  passed (256 tests); `bun run db:migrate:test && bun run db:seed:test` passed (38 tables;
  5 areas, 3 routes, 4 source profiles); `bun run build` passed; `bun run test:e2e` passed
  (17 tests).
  Commit: this commit (`Add Responses tool loop runtime`).
  Next step: Step 7, Source Consistency Validator.
