# Priority 1 Live Place Recommendations Progress

Source plan: `/Users/alexmetelli/source/ask-siargao/PLAN.md`
Source roadmap: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`

## Current Status

Step 3 is complete. Step 4 is next: Normalize Candidates Into LocalRecommendation.

This file must be updated after every completed step with the completed step, validation results,
commit reference if available, current status, and next step.

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Shared Place Intent Model
- [x] Step 2: Route Priority 1 Requests Through The Recommendation Agent
- [x] Step 3: Generalize The Recommendation Agent From Food To Places
- [ ] Step 4: Normalize Candidates Into LocalRecommendation
- [ ] Step 5: Harden Cache-First Live Provider Behavior
- [ ] Step 6: Render Priority 1 Answers With Checked And Not Checked Caveats
- [ ] Step 7: End-To-End Priority 1 Verification And Documentation

## Update Log

### Step 0: Progress and Changelog Tracking Setup

- Status: Complete.
- Validation:
  - Confirmed `PROGRESS.md` exists and contains the full implementation step checklist.
  - Confirmed `CHANGELOG.md` exists, starts with `# Changelog`, includes the Keep a Changelog
    preamble, and has an `## [Unreleased]` section.
- Commit: `28c6734 chore: add progress and changelog tracking`.
- Next step: Step 1, Shared Place Intent Model.

### Step 1: Shared Place Intent Model

- Status: Complete.
- Summary:
  - Added the shared `PlaceIntent` model and deterministic helper functions for Priority 1 place
    categories, live needs, recent-context follow-ups, location inference, constraints, avoid
    terms, radius defaults, and specific-place names.
  - Routed chat-route place classification through the shared model while preserving weather,
    beach, and activity-plan routing.
  - Reused the shared model inside the recommendation agent so the prior food intent detection no
    longer lives in multiple modules.
  - Added focused unit coverage for open-now food, covered cafe, beachfront place, open-now
    follow-up, and named-place map-link prompts.
- Validation:
  - `bun run format`: passed; no fixes applied.
  - `bun run lint`: passed.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 164 tests.
  - `bun run db:migrate:test`: passed, migrated 38 tables.
  - `bun run db:seed:test`: passed, seeded 5 areas, 3 routes, and 4 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 17 tests.
- Commit: `6f55ce7 feat: add shared place intent classification`.
- Next step: Step 2, Route Priority 1 Requests Through The Recommendation Agent.

### Step 2: Route Priority 1 Requests Through The Recommendation Agent

- Status: Complete.
- Summary:
  - Confirmed chat-route recommendation routing now uses `placeIntent` instead of a food-only
    flag, so Priority 1 place requests are evaluated before generic LLM fallback.
  - Added route-level coverage for bar/drinks requests, service-place open-now prompts, and
    named-place map-link follow-ups.
  - Kept existing weather, ordinary chat, grounded beach, activity-plan, and bounded
    recommendation-failure behaviors passing.
- Validation:
  - `bun run format`: passed; no fixes applied.
  - `bun run lint`: passed.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 167 tests.
  - `bun run db:migrate:test`: passed, migrated 38 tables.
  - `bun run db:seed:test`: passed, seeded 5 areas, 3 routes, and 4 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 17 tests.
- Commit: `f2aa10d feat: route live place requests through recommendations`.
- Next step: Step 3, Generalize The Recommendation Agent From Food To Places.

### Step 3: Generalize The Recommendation Agent From Food To Places

- Status: Complete.
- Summary:
  - Generalized deterministic recommendation-agent planning around `PlaceIntent` instead of
    food-only request helpers.
  - Added deterministic Places searches for open-now nearby food, cafes, bars/drinks,
    activity-place prompts, service-place prompts, and specific-place identity/map-link prompts.
  - Carried `PlaceIntent.radiusMeters` into Places searches and added category-aware search terms,
    included types, and preferred ranking terms.
  - Added focused recommendation-agent coverage for one-search open-now food behavior, bar
    `includedType`, service-place routing, and narrow specific-place identity queries.
- Validation:
  - `bun run format`: passed; no fixes applied.
  - `bun run lint`: passed.
  - `bun run typecheck --incremental false`: passed.
  - `bun test`: passed, 171 tests.
  - `bun run db:migrate:test`: passed, migrated 38 tables.
  - `bun run db:seed:test`: passed, seeded 5 areas, 3 routes, and 4 source profiles.
  - `bun run build`: passed.
  - `bun run test:e2e`: passed, 17 tests.
- Commit: `feat: generalize recommendations to local places`.
- Next step: Step 4, Normalize Candidates Into LocalRecommendation.
