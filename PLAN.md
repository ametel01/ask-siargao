# Implementation Plan

## Source Documents

- Path: `.stow-notes.md`
  - Role: Primary product brief.
  - Summary: Defines the on-demand Siargao Reality Check wedge, its synchronous interaction
    boundary, prioritized use cases, structured decision outcome, evidence expectations, and the
    explicit exclusion of continuous agents, monitoring, notifications, and guaranteed operator
    work.
- Path: `AGENTS.md`
  - Role: Repository delivery constraints.
  - Summary: Defines project structure, Bun/Next.js conventions, required tests and quality gates,
    provider-governance constraints, semantic evidence-ordering coverage, artifact-selection
    coverage, and reviewer independence requirements.
- Path: `documentation/developer/explanation/chat-agent-routing-and-source-governance.md`
  - Role: Current chat architecture contract.
  - Summary: Keeps natural-language tool choice with the model while deterministic code owns
    privacy, source labels, artifact selection, and bounded evidence repair.
- Path: `documentation/developer/explanation/siargao-chatbot-data-pipeline.md`
  - Role: Current product and data-flow context.
  - Summary: Establishes the chat-first tour-operator direction, request-time freshness decisions,
    normalized Siargao facts, provenance, confidence, provider retention, and lazy acquisition.
- Path: `documentation/developer/reference/routes-and-surfaces.md`
  - Role: Public API, persistence, privacy, and sharing contract.
  - Summary: Documents `/chat`, `/api/chat`, authenticated history, structured public artifacts,
    source disclosure, saved-trip boundaries, and privacy controls that the new feature must
    preserve.

Planned against the repository state on 2026-08-03. Before executing each step, inspect the current
revision and touched paths, preserve unrelated changes, and adapt for drift without weakening this
plan's product or evidence contracts.

## Goals

- Reposition the primary chat experience around an on-demand “Siargao Reality Check” that produces
  a direct, structured verdict for an accommodation, itinerary, immediate plan, surf session, or
  disrupted plan.
- Return a consistent `keep`, `change`, `avoid`, or `needs_confirmation` verdict with the subject,
  best action, evidence-backed basis, timing/area when useful, fallback, avoid guidance, and truthful
  source state.
- Reuse the existing request/response lifecycle, chat agent, governed tools, decision summaries,
  itinerary artifacts, recommendation cards, history persistence, and Trip Pass metering.
- Ensure current-condition and place-specific claims use the evidence required for that claim at
  request time, while provider failure degrades to `needs_confirmation` or bounded fallback advice.
- Make the wedge visible through landing-page copy, starter prompts, chat presentation, and
  representative end-to-end coverage.
- Preserve request-time-only execution: no agent or model work begins until a traveler submits a
  message.

## Non-Goals

- A continuously running agent, background monitoring, scheduled itinerary evaluation, proactive
  alerts, push/email/WhatsApp notifications, or automatic re-planning.
- Guaranteed human availability, operator response SLAs, a local request desk, concierge workflow,
  CRM, marketplace, booking, cancellation, payment to operators, or inventory management.
- A new native application, separate reality-check route, separate checkout product, or new Trip
  Pass meter.
- Broad coverage outside Siargao or a general-purpose travel planning assistant.
- Claiming that Ask Siargao already possesses complete property-noise, flooding, power, internet,
  road, availability, or operator-reliability data.
- Replacing the model-owned tool-selection architecture with a general route classifier. Narrow
  deterministic policy may recognize an explicit reality-check request to validate output and
  evidence, but it must not precompute the whole answer or secretly select all tools.
- Saving standalone decision summaries as new saved-trip artifact types in the first release.
  Authenticated chat history persistence remains required; save/share expansion is deferred.
- Database schema changes unless implementation proves the existing JSON decision-summary storage
  cannot carry backward-compatible optional fields.

## Definition of Done

- A traveler can ask each of the following in `/chat` and receive an on-demand response through the
  existing `/api/chat` request: accommodation reality check, itinerary feasibility check,
  today/tomorrow decision check, surf-session check, and disruption recovery.
- Qualifying answers display one primary structured reality-check summary with a normalized kind,
  subject, verdict, best action, basis, and applicable fallback/avoid/timing/area fields. Ordinary
  Siargao questions remain supported and do not receive a forced verdict when one would be
  misleading.
- Missing essential traveler input results in a focused clarification request rather than an
  invented verdict. Missing or failed external evidence cannot produce an unsupported checked/live
  claim and results in `needs_confirmation` when the verdict depends on that evidence.
- Accommodation checks resolve the named property when possible and clearly separate verified
  property facts, governed area-fit knowledge, traveler constraints, and unknown qualities such as
  recurring noise or reliability.
- Itinerary checks identify concrete sequencing, geography, transport, timing, reservation, weather
  exposure, and constraint conflicts only when supported by traveler input or governed evidence;
  estimates are labeled as estimates.
- Today/tomorrow and surf checks use successful condition/weather/marine/tide evidence before a
  positive current-condition verdict. Evidence tools whose semantic contract requires ordering
  complete in the required order, with regression coverage that fails if downstream work begins
  prematurely.
- Disruption recovery returns a feasible request-time replacement or a bounded
  `needs_confirmation` outcome; it does not promise monitoring, automatic intervention, or a human
  confirmation.
- Strict artifact selection exposes only the reality-check summary, cards, and itinerary artifacts
  selected for the final answer. Tests cover omitted/auto-selected paths and adversarial explicit
  mixed selections containing allowed and disallowed artifacts, including mixed `displayCardIds`.
- The decision summary remains safe through public-turn sanitization, authenticated chat
  persistence/hydration, source-consistency validation, and old stored summaries that lack the new
  optional fields. No private tool arguments, precise coordinates, raw provider payloads, or
  internal caveats are exposed.
- Opening `/chat` does not call the chat agent or model. Only explicit message submission starts a
  reality check; no scheduler, recurring job, notification transport, or background agent is added.
- Landing and chat entry points use the on-demand reality-check positioning without promising
  continuous monitoring, human confirmation, bookings, guaranteed accuracy, or provider
  availability.
- Sanitized observability records reality-check kind, verdict, source-state counts, latency, and
  artifact counts without storing raw prompts, exact location, provider payloads, or model
  reasoning.
- Relevant unit, integration, persistence, source-governance, route, component, and Playwright tests
  pass, followed by the repository's complete `bun run verify:ci` release gate.
- Developer documentation explains the reality-check contract, verdict semantics, evidence
  boundaries, request-time-only lifecycle, extension points, and deliberately deferred work.
- `PROGRESS.md` and `CHANGELOG.md` are current, every incremental step is committed independently,
  and any pre-existing gate failure or intentionally deferred risk is recorded explicitly.

## Assumptions and Open Questions

- **Primary surface:** use the existing `/chat` surface and `/api/chat`; do not create a wizard or a
  second request API unless implementation evidence shows the existing request contract cannot
  support the structured result.
- **Backward compatibility:** add optional `kind`, `verdict`, and `subject` fields to the existing
  `DecisionSummary` JSON shape. Existing condition summaries and persisted history without those
  fields must continue to render.
- **Structured model output:** extend the existing structured final payload with an optional
  reality-check proposal containing explicit evidence tool-call IDs. The server, not the model,
  constructs the public `DecisionSummary`, attaches only sources from validated tool calls, and
  rejects or repairs unknown IDs and unsupported positive/current claims.
- **Verdict semantics:** `keep` means the submitted plan is workable on the evidence available;
  `change` means it is workable after a named modification; `avoid` means a material conflict makes
  the submitted plan unsuitable; `needs_confirmation` means the decision depends on information
  that could not be sufficiently checked. Missing essential input should normally produce a
  clarification question instead of `needs_confirmation`.
- **Evidence-free reasoning:** a verdict may have no external source only when its basis is strictly
  derived from traveler-supplied constraints or transparent arithmetic. It must not contain local,
  current, provider, travel-time, safety, or property claims.
- **Accommodation depth:** the first release evaluates evidence that actually exists. It must not
  infer quietness, flooding, internet/power reliability, room condition, availability, or safety
  from ratings, generic reviews, area stereotypes, or absence of complaints.
- **Itinerary parsing:** use the existing conversation payload and model to extract a bounded plan;
  add typed tool inputs only where a deterministic itinerary check needs them. Do not persist a new
  raw itinerary document outside existing chat-history rules.
- **Current-condition ordering:** preserve the repository rule that upstream evidence completes
  before a downstream artifact or recommendation that semantically depends on it starts. Independent
  evidence calls may remain concurrent only when the policy explicitly says they are independent.
- **Product analytics:** use the existing sanitized server-event pathway. If it cannot represent the
  required coarse fields, extend that pathway rather than adding a second analytics provider.
- **Trip Pass:** a reality check consumes the existing single successful travel-answer unit. Tool
  count does not become customer-visible and no new quota is introduced.
- **Toolchain drift:** use the Bun version and commands pinned by `package.json` and CI at execution
  time. If README or local documentation disagrees with those executable sources, record and resolve
  the drift before relying on the full gate.
- **Release decision:** the exact marketing headline can be tuned during UI implementation, but it
  must preserve “on demand,” “reality-check,” current/local evidence, and no monitoring or human
  promise.

## Implementation Approach

Keep the existing chat data path:

```text
explicit traveler message
  -> existing request validation and trip context
  -> model-owned governed tool choice
  -> bounded reality-check evidence/output policy
  -> server-validated structured verdict
  -> existing public sanitization and source consistency
  -> chat UI + authenticated history
```

Introduce a small `reality-check` domain module under `src/server/chat` that owns kinds, verdicts,
explicit-request recognition, structured proposal validation, source sufficiency, and stable summary
construction. Recognition is an output/evidence guardrail, not a general tool router. Keep the
existing `DecisionSummary` as the public artifact, adding backward-compatible optional metadata
rather than creating a parallel artifact system.

Extend the structured final response contract so the model may propose one reality check with its
kind, subject, verdict, decision fields, and the specific completed tool-call IDs supporting it. The
runtime validates that those IDs exist, belong to the turn, are included in `usedToolCallIds`, and
support the claim. It then creates the summary and derives public sources from the validated calls.
Unknown, unselected, failed, or semantically insufficient evidence must fail closed. A bounded repair
may ask the model to correct the structure or downgrade the verdict, using the existing repair
budget.

Implement the five prioritized use cases as vertical slices. Prefer existing tools and data:

- accommodation: Places/details for identity and public property facts, governed local facts or
  local-guide evidence for area fit, and web research only for current public facts that need it;
- itinerary: trip context, local itinerary tools, local geography estimates, Places, and current
  condition evidence only when the proposed plan requires them;
- today/tomorrow and surf: condition, weather, marine, tide, local-guide/memory, and place evidence
  with semantic ordering where a recommendation depends on an upstream check;
- disruption: treat the reported disruption as traveler-supplied state, then check the replacement
  at request time and return an itinerary/card only when it is compatible and supportable.

Render the enhanced summary through the existing decision strip. Add a concise verdict badge and
subject while retaining current source-status, backup, avoid, where, and when presentation. Preserve
old summaries. Update landing and suggested prompts only after the backend contract is proven.

No migration is expected because `decision_summaries_json` already stores JSON arrays. If a migration
becomes necessary, add a new append-only migration, validate both PostgreSQL and PGlite paths, and
document rollback/compatibility before proceeding.

## Quality Gates

- Setup status: Existing gates are configured in `package.json`, `biome.json`,
  `.github/workflows/ci.yml`, Playwright configuration, and the database test scripts; no quality-gate
  setup step is required.
- Baseline command: `bun run verify:ci`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck --incremental false`, `bun run db:migrate:test`,
  `bun run db:seed:test`, `bun run build`, and `bun run test:e2e`
- Advisory React check after UI work: `bun run doctor`
- Full post-step gate sequence: `bun run format && bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test && bun run build && bun run test:e2e`
- Final non-mutating release gate: `bun run verify:ci`

## Progress Tracking

- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` if absent, or add a clearly separated “On-Demand Siargao
  Reality Check” section while preserving prior history, before any quality-gate run or
  implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation
  results, commit reference if available, current status, unresolved risks, and next step.

## Changelog Tracking

- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` if absent before implementation starts; if it exists, preserve
  its history and verify it has `# Changelog`, the standard preamble, and an `## [Unreleased]`
  section at the top.
- Initial content: Include `# Changelog`, the standard preamble, and `## [Unreleased]`.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` before committing
  only when that step shipped a functional change. Use only applicable `Added`, `Changed`,
  `Deprecated`, `Removed`, `Fixed`, or `Security` headings; omit empty headings. Do not add entries
  for plans, progress tracking, docs-only changes, tests, coverage, CI, validation, or framework
  housekeeping.

## Goal Handoff

- Readiness: This plan is ready to be used as a `/goal` payload.
- Scope: The `/goal` should execute only the work described here unless the user explicitly expands
  it. In particular, it must not add background agents, monitoring, notifications, human/operator
  workflows, or booking actions.
- Done: The `/goal` is complete only when every item in `## Definition of Done` is satisfied, every
  incremental step is complete and committed, required gates pass or documented pre-existing
  failures are handled, `PROGRESS.md` and `CHANGELOG.md` are current, and the final state is
  summarized for the user.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup

Goal: Establish durable execution tracking before validation or implementation begins.

Changes:

- Inspect existing `PROGRESS.md` and `CHANGELOG.md` without deleting historical content.
- Create `PROGRESS.md` if absent; otherwise add a clearly separated section for this plan containing
  the source paths, full step checklist, current status, and update log.
- Create `CHANGELOG.md` if absent with Keep a Changelog 1.0.0 structure; otherwise verify and retain
  its existing preamble, `## [Unreleased]`, and release history.
- State in `PROGRESS.md` that it must be updated after every completed step.

Acceptance criteria:

- `PROGRESS.md` contains Steps 0–8, current status, and the next step.
- `CHANGELOG.md` follows the required structure without an entry for this planning/tracking work.
- Existing history in either file remains intact.

Validation:

- Confirm both files exist and inspect their required headings and checklist.
- Run `git diff --check`.

Progress:

- Mark Step 0 complete in `PROGRESS.md`, record validation, current status, and Step 1 as next.

Changelog:

- Do not add an entry; tracking setup is not a functional change.

Commit:

- `Set up reality check progress tracking`

### Step 1: Baseline and Reality-Check Domain Contract

Goal: Establish a green baseline and encode the product vocabulary before changing behavior.

Depends on:

- Step 0

Changes:

- Run the baseline `bun run verify:ci` and record its result, duration, revision, and any pre-existing
  failures in `PROGRESS.md`.
- Add `src/server/chat/reality-check.ts` with bounded kinds, verdicts, proposal/summary types,
  normalization limits, verdict semantics, and narrow recognition of explicit reality-check
  language.
- Add `src/server/chat/reality-check.test.ts` covering the five target kinds, ordinary non-check
  questions, missing-input clarification cases, unsupported fields, length bounds, and the
  request-time-only constraint.
- Extend `DecisionSummary` in `src/server/chat/agent-runtime.ts` with optional `kind`, `verdict`, and
  `subject` metadata so old stored summaries remain valid.
- Add focused compatibility tests in `src/server/chat/agent-runtime.test.ts` and
  `src/server/chat/public-turn-assembly.test.ts` for new and legacy summaries.

Acceptance criteria:

- The domain vocabulary exactly matches the product brief.
- Recognition does not select tools, call providers, or classify ordinary Siargao answers as
  reality checks.
- Existing summaries without the optional fields continue through runtime and public assembly.
- This step advances Definition of Done by fixing the contract used by every later slice.

Validation:

- Run the full post-step gate sequence from `## Quality Gates`.
- Fix all failures before proceeding.

Progress:

- Update `PROGRESS.md` with baseline and post-change results, commit reference if available, status,
  residual risks, and Step 2 as next.

Changelog:

- Do not add an entry unless the new fields are already exposed as observable product behavior in
  this step.

Commit:

- `Define on-demand reality check contract`

### Step 2: Server-Validated Structured Verdicts

Goal: Turn a qualifying model answer into one safe, source-backed decision summary.

Depends on:

- Steps 0–1

Changes:

- Extend the structured response contract and parser in
  `src/server/chat/ask-siargao-agent.ts` with an optional reality-check proposal and explicit
  evidence tool-call IDs.
- Validate proposal shape, kind, verdict, subject, text bounds, tool-call existence, subset
  relationships, completion status, and source sufficiency in `src/server/chat/reality-check.ts`.
- Build the stable public summary server-side and attach sources only from validated calls; do not
  trust model-supplied source objects or artifact IDs.
- Add bounded repair behavior when an explicit reality check omits a summary, references unknown
  calls, selects insufficient evidence, or makes a positive/current claim after a terminal provider
  failure. Downgrade to `needs_confirmation` only when supported; otherwise ask for clarification.
- Integrate the resulting summary with strict artifact selection in
  `src/server/chat/agent-runtime.ts`, existing public-turn sanitization, source consistency,
  persistence, and hydrated history.
- Emit a sanitized server event containing kind, verdict, evidence/source-state counts, latency,
  and artifact counts only.
- Add agent, runtime, public-turn, route, history, observability, unknown-ID, failed-provider,
  auto-selection, and adversarial mixed-selection tests. Include mixed `displayCardIds` containing
  allowed and disallowed cards.

Acceptance criteria:

- The public verdict is constructed from validated server data and cannot carry model-invented
  source metadata.
- Current/checked claims fail closed when the referenced provider failed or was not used.
- Old structured payloads without a reality-check proposal remain accepted.
- Stored and hydrated summaries preserve safe fields and exclude internal/private data.
- This step advances Definition of Done by making the shared verdict contract enforceable.

Validation:

- Run the full post-step gate sequence from `## Quality Gates`.
- Fix all failures before proceeding.

Progress:

- Update `PROGRESS.md` with results, commit reference if available, current status, residual risks,
  and Step 3 as next.

Changelog:

- Under `## [Unreleased]`, add an `Added` entry for structured, source-backed reality-check verdicts.

Commit:

- `Return validated reality check verdicts`

### Step 3: Accommodation Reality Check Vertical Slice

Goal: Let travelers evaluate an accommodation or stay area before booking without inventing
property qualities.

Depends on:

- Steps 0–2

Changes:

- Add focused accommodation-check instructions and output requirements to the agent contract.
- Extend the narrow evidence policy so named-property identity/details use Places/details evidence,
  current public claims use web evidence when necessary, and area-fit claims use governed local
  facts or local-guide evidence.
- Reuse trip context for kids, budget, transport, quiet sleep, accommodation, area, and dates.
- Require clarification when the property/area or decision criteria are too ambiguous to evaluate.
- Force unknown recurring noise, flooding, internet/power reliability, room condition, availability,
  and similar unsupported claims into bounded uncertainty or `needs_confirmation`.
- Update/add focused tests in `src/server/chat/ask-siargao-agent.test.ts`,
  `src/server/chat/required-evidence.test.ts`, `src/server/chat/trip-context.test.ts`, and route tests
  for exact-property, area-comparison, quiet-family-budget, missing-property, provider-failure, and
  mixed-card cases.

Acceptance criteria:

- “Reality-check this hotel before I book” produces a property/area-specific verdict when evidence
  is sufficient and a focused clarification otherwise.
- The response distinguishes checked property facts, governed area fit, traveler constraints, and
  unknown property qualities.
- Failed Places/web evidence cannot yield a positive property-specific checked claim or disallowed
  place card.
- This step completes the first-ranked vertical slice in Definition of Done.

Validation:

- Run the full post-step gate sequence from `## Quality Gates`.
- Fix all failures before proceeding.

Progress:

- Update `PROGRESS.md` with results, commit reference if available, status, residual risks, and Step
  4 as next.

Changelog:

- Under `## [Unreleased]`, add an `Added` entry for on-demand accommodation reality checks.

Commit:

- `Add accommodation reality checks`

### Step 4: Itinerary Feasibility Vertical Slice

Goal: Review a traveler-supplied itinerary for practical conflicts and return a concrete revision.

Depends on:

- Steps 0–3

Changes:

- Add a bounded typed itinerary-review input to `src/server/chat/itinerary-tools.ts` or a focused
  sibling module if that keeps the existing theme planner deeper and simpler. Accept only the
  minimum structured fields needed for up to seven days/stops, timing, areas, transport, and
  constraints.
- Reuse local geography/ride estimates, trip context, local facts, Places, and current-condition
  tools only where relevant. Label non-live travel time as an estimate.
- Produce concrete conflicts and one revised action/fallback without silently inventing reservations,
  opening hours, exact route duration, or availability.
- Preserve the rule that semantic upstream checks finish before dependent recommendation artifacts
  begin. Add a regression whose deferred upstream promise proves downstream work does not start
  early.
- Add tool, agent, runtime, route, and artifact-selection tests for a multi-day plan, Cloud 9 to
  Pacifico before an early Dapa ferry, kids/no-scooter constraints, weather-sensitive sequencing,
  missing day/time details, and mixed selected/unselected itineraries/cards.

Acceptance criteria:

- “Is this four-day itinerary actually feasible?” returns a `keep`, `change`, `avoid`, or focused
  clarification outcome with specific conflicts and a practical revision.
- All travel-time/current/place claims are either sourced, transparently estimated, or omitted.
- The original plan remains visible in prose/context without persisting a new ungoverned raw-plan
  record.
- This step completes the second-ranked vertical slice in Definition of Done.

Validation:

- Run the full post-step gate sequence from `## Quality Gates`.
- Fix all failures before proceeding.

Progress:

- Update `PROGRESS.md` with results, commit reference if available, status, residual risks, and Step
  5 as next.

Changelog:

- Under `## [Unreleased]`, add an `Added` entry for itinerary feasibility checks.

Commit:

- `Add itinerary feasibility checks`

### Step 5: Today/Tomorrow and Surf Decision Vertical Slices

Goal: Produce trustworthy request-time decisions for immediate activities and surf sessions.

Depends on:

- Steps 0–4

Changes:

- Extend the reality-check evidence policy for weather-sensitive activities and surf so successful
  current-condition verdicts reference the relevant condition/weather/marine/tide calls.
- Reuse `get_condition_judgment`, `get_weather_forecast`, `get_marine_conditions`,
  `get_tide_forecast`, `rank_surf_spots_nearby`, local guide, and surf memory as appropriate.
- Require skill level and adequate location/time context for surf matching; ask a focused
  clarification when they materially change the answer.
- Keep surf outputs at planning-support level and preserve local-coach, rip-current, lifeguard, and
  exact-break safety boundaries. Never imply a safe-to-surf guarantee.
- Add semantic ordering tests for condition/tide lookup before dependent surf/place recommendations,
  plus terminal-provider-failure, partial-evidence, selected-artifact, and adversarial mixed-card
  tests.
- Add agent quality fixtures for “Given today's weather and tide, should we still go?” and a
  beginner surf-session request.

Acceptance criteria:

- Immediate decisions show when/where, a current evidence-backed basis, and a fallback or
  `needs_confirmation` outcome.
- Surf decisions account for supplied ability and constraints without claiming exact-break safety.
- Provider failure cannot be rendered as checked/current evidence.
- This step completes the third- and fourth-ranked vertical slices in Definition of Done.

Validation:

- Run the full post-step gate sequence from `## Quality Gates`.
- Fix all failures before proceeding.

Progress:

- Update `PROGRESS.md` with results, commit reference if available, status, residual risks, and Step
  6 as next.

Changelog:

- Under `## [Unreleased]`, add an `Added` entry for on-demand condition and surf reality checks.

Commit:

- `Add current condition reality checks`

### Step 6: Disruption Recovery Vertical Slice

Goal: Replace a traveler-reported failed plan with a feasible request-time alternative.

Depends on:

- Steps 0–5

Changes:

- Recognize an explicit traveler-reported cancellation, closure, weather disruption, illness, or
  transport loss as current conversation state; do not claim the app independently detected it.
- Select existing itinerary, local guide, Places, and condition tools based on the replacement's
  needs, preserving upstream-before-downstream evidence ordering.
- Return one best replacement plus a bounded fallback/avoid instruction; use `needs_confirmation`
  when current availability or conditions cannot be established.
- Ensure recommendation cards and itinerary artifacts from failed/disallowed provider results are
  not selectable, including adversarial mixed `displayCardIds` and `displayItineraryIds`.
- Add agent, runtime, source-governance, and route tests for a cancelled island tour, heavy rain, no
  scooter, a closed venue, complete provider failure, and successful local/cached fallback.

Acceptance criteria:

- “Our island tour was cancelled. Give us a workable replacement” produces a synchronous
  alternative grounded in reported state and request-time evidence.
- Copy never implies monitoring, automatic cancellation detection, operator contact, booking, or
  guaranteed availability.
- This step completes the fifth-ranked vertical slice in Definition of Done.

Validation:

- Run the full post-step gate sequence from `## Quality Gates`.
- Fix all failures before proceeding.

Progress:

- Update `PROGRESS.md` with results, commit reference if available, status, residual risks, and Step
  7 as next.

Changelog:

- Under `## [Unreleased]`, add an `Added` entry for on-demand disruption recovery checks.

Commit:

- `Add disruption recovery checks`

### Step 7: Reality-Check Presentation and Product Entry Points

Goal: Make the new product promise clear and the structured verdict easy to act on.

Depends on:

- Steps 0–6

Changes:

- Update `src/features/chat/decision-strip-presentation.ts` and the decision-strip component in
  `src/features/chat/ChatWorkspace.tsx` to show the optional subject and verdict with accessible,
  non-color-only labels while preserving legacy summaries.
- Update `src/features/chat/suggested-prompts.ts` so empty and context-aware states prioritize
  accommodation, itinerary, today/tomorrow, surf, and disruption reality-check prompts.
- Update `src/features/landing/LandingPage.tsx` and Trip Pass public copy where appropriate to lead
  with on-demand reality checks and avoid background/human/booking promises.
- Preserve save/share, source panel, mobile layout, reduced-motion behavior, focus order, and
  responsive constraints.
- Add/update component tests and Playwright coverage for desktop/mobile verdict display, legacy
  history, source state, keyboard/focus behavior, suggested prompts, and the guarantee that loading
  `/chat` does not submit `/api/chat` or start agent work.
- Capture updated landing/chat screenshots through the existing Playwright artifact conventions.
- Run `bun run doctor` after UI tests and triage findings without treating advisory noise as a
  release blocker unless it identifies a real regression.

Acceptance criteria:

- The landing page and chat explain what Ask Siargao does in one scan and present representative
  reality-check entry points.
- A traveler can distinguish keep/change/avoid/needs-confirmation without reading all prose.
- No surface promises monitoring, notifications, human confirmation, booking, or guaranteed
  current data.
- `/chat` remains idle until explicit submission.
- This step completes the user-visible positioning and presentation portions of Definition of Done.

Validation:

- Run `bun run doctor` and record actionable findings.
- Run the full post-step gate sequence from `## Quality Gates`.
- Fix all failures before proceeding.

Progress:

- Update `PROGRESS.md` with results, screenshot paths, commit reference if available, status,
  residual risks, and Step 8 as next.

Changelog:

- Under `## [Unreleased]`, add a `Changed` entry for the reality-check positioning and structured
  verdict presentation.

Commit:

- `Present Ask Siargao reality checks`

### Step 8: Documentation, Evaluation, and Release Proof

Goal: Document the finished contract and prove the complete feature against repository gates.

Depends on:

- Steps 0–7

Changes:

- Add/update developer explanation docs for reality-check kinds, verdict semantics, structured
  payload validation, source sufficiency, semantic ordering, provider failure, persistence, and the
  synchronous request lifecycle.
- Update `README.md`, routes/surfaces documentation if the response contract changed, and the data
  pipeline/product-direction docs to use the on-demand reality-check positioning.
- Add a deterministic evaluation matrix covering at least the five representative prompts from the
  source brief plus missing input, provider failure, partial evidence, legacy response, and mixed
  artifact-selection cases.
- Inspect the final diff for scheduler, notification, background-agent, operator, booking, privacy,
  raw-provider, or unsupported marketing scope creep.
- Run the final non-mutating `bun run verify:ci` gate from a clean generated-output state and record
  exact results.
- Reconcile `PROGRESS.md` and qualifying `CHANGELOG.md` entries; record any coverage gap with reason,
  residual risk, and next checker/maintainer action as required by `AGENTS.md`.

Acceptance criteria:

- Documentation is sufficient for a new maintainer to extend a reality-check kind without weakening
  evidence or privacy contracts.
- Evaluation covers all five product scenarios and fail-closed cases.
- The final diff contains no out-of-scope continuous behavior or promises.
- Every Definition of Done item is checked in `PROGRESS.md` and the final release gate passes, or a
  pre-existing failure is documented with evidence and explicit next action.

Validation:

- Run `bun run format` for final formatting.
- Run `bun run verify:ci` as the authoritative non-mutating release gate.
- Run `git diff --check` and inspect `git status --short`.
- Fix all feature-caused failures before completion.

Progress:

- Mark Step 8 and the overall plan complete in `PROGRESS.md`; record validation, all commit
  references, residual risks, and the final repository state.

Changelog:

- Add no entry for docs, evaluation, or validation alone. Reconcile only the qualifying functional
  entries already added under `## [Unreleased]`.

Commit:

- `Document on-demand reality checks`
