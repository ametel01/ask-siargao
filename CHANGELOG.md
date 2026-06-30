# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning when releases are tagged.

## [Unreleased]

### Added

- Started progress tracking for the web research layer implementation plan.
- Added deterministic web research query planning, source classification, source scoring, finding
  extraction, entity hints, and no-network regression coverage.
- Added the strict `research_web` chat tool with dependency-injected public web evidence,
  source-backed output, insufficient-evidence handling, and provider-unavailable responses.
- Added web research source labels and typed research contracts for the planned `research_web`
  chat tool.

### Security

- Documented the final authenticated data privacy checklist for persisted chat,
  ratings, profile, saved-trip ownership, and public shared-trip boundaries.
- Added saved-trip owner checks so authenticated delete and share attempts for
  another user's saved trip return `404` and public share DTOs still omit owner,
  profile, chat, provider payload, and geolocation data.
- Stored authenticated chat history now keeps browser geolocation as summaries
  without exact coordinates and persists tool-call summaries without raw
  arguments.
- Prevented memory retrieval from backing checked, provider, curated, or provider-unavailable
  source labels, and validated selected card sources before returning public chat responses.
- Hardened shared-trip source-policy and privacy coverage so public shared DTOs preserve allowed
  source metadata while rejecting raw provider payloads, Google review fields, tool-call arguments,
  full chat transcripts, browser geolocation, and exact coordinates.

### Fixed

- Preserved loaded nightlife memory baselines when current event lookup has no matching event
  facts, so nightlife recommendation answers no longer collapse to weather-only or generic
  Places fallbacks.
- Aligned browser-geolocation e2e coverage with the current trip-session active-location state after
  sending a near-me chat request.
- Prevented Dapa breakfast answers from exposing unrelated beach cards when multiple successful
  tool calls produce mixed artifact types.
- Aligned shared-trip public source policy so captured source freshness, checked/not-checked
  signals, source labels, and open-status labels remain visible with not-reverified caveats;
  structured shared itinerary fallbacks keep map links/areas/caveats; and Playwright now covers
  public share rendering plus the generic unavailable state.
- Classified boat/Sugba ride condition prompts as boat-trip judgments instead of scooter checks,
  kept valid Places "current opening status" source wording from being treated as ocean-current
  evidence, scoped curated local caveats to beach-relevant condition judgments, kept condition
  evidence repair active for mixed itinerary-and-condition prompts, required named-beach caveats
  to match the requested beach, preserved marine condition evidence for mixed scooter-and-boat
  prompts without treating land/scooter tours as boat trips, made condition repair matching honor
  required beach names and constraints, kept boat/Sugba wave prompts on boat-trip evidence,
  prevented generic swimming judgments from inheriting one named beach's caveat, inherited
  condition intent for temporal follow-ups, mapped tomorrow condition repairs to a clearly labeled
  next-seven-days proxy range, rejected fabricated checked road/safety/official-warning labels, and
  documented condition judgment repair as a narrow validation exception.
- Enforced condition judgment evidence before final condition prose, allowed condition-backed
  curated local guide source labels, applied seven-day weather risk metrics to next-week condition
  judgments, and rejected checked tide/surf claims in source details.
- Kept condition judgment source validation from accepting checked tide or surf labels before
  provider-backed marine tools exist, while preserving model-written chat answers backed by
  condition tool evidence.
- Tightened itinerary repair classification so logistics and transfer prompts with bare duration
  language do not force itinerary artifacts, while scoped local plans before airport/ferry timing
  still enforce planning; scoped live weather and Places artifact hydration to matching required
  tool evidence.
- Enforced true open-now Places filtering for required itinerary checks, kept outdoor dry-break
  fallbacks from being promoted during high weather risk, made itinerary origins affect venue
  checks or surface unsupported route timing, and validated itinerary artifact source labels at the
  chat API boundary.
- Required a successful itinerary artifact before final itinerary prose, covered sandy beach
  half-day repair triggers without explicit plan verbs, and corrected the progress handoff note for
  tracked `PLAN.md`.
- Refreshed structured itinerary artifacts with successful live weather and Places follow-up
  evidence, reconciled top-level chat sources after itinerary checks, and gave route scenario tests
  distinct itinerary fixtures.
- Required structured itinerary planning before final prose for clear itinerary prompts, kept
  open-now caveats until Places returns opening-hours evidence, and stopped food-crawl artifacts
  from claiming curated beach-guide source support.
- Stopped itinerary beach stops from labeling General Luna ride estimates as previous-stop travel
  times, preserved user itinerary constraints in artifacts and caveats, and made live-check caveat
  reconciliation require every required weather or Places follow-up to succeed.
- Enforced required itinerary weather and Google Places follow-up checks before accepting final
  agent prose, and reconciled itinerary artifact source caveats after those checks complete.
- Updated strict Responses tool schemas so optional fields are provider-valid required nullable
  properties, with regression coverage for nested strict schema requirements.
- Preserved returned Google Places detail hours, rating, rating-count, and price signals in live
  detail cards and model-facing tool text.
- Prevented safe local source evidence lookup from returning audit-only/private evidence metadata,
  accepting fabricated curated guide fact IDs, or dropping route facts when a query combines area
  and serialized tags.
- Tightened safe local fact queries to exclude non-display-safe source profiles, search area/text
  filters independently, return public entity registry rows, and time out slow database calls.
- Stopped expired governed local facts and source evidence from being returned or labeled as
  `fresh_cache`.
- Deleted stale hosted file-search memory attachments when reference memory files are replaced or
  duplicate older checksums remain in the same vector store.
- Bound backend `search_agent_memory` tool calls to the already resolved turn memory snapshot.
- Redacted server-only memory deployment metadata from public chat responses.
- Removed server-only memory deployment metadata from model-facing prompt and memory-search tool
  payloads.

### Changed

- Verified Hallmark audit remediation with final smell scans, viewport evidence, and a sanitized
  full CI gate; final landing overlays now use named gradient tokens.
- Simplified audited app/report surfaces by making shared app panels and cards less nested,
  moving report content to row-style groups, and tokenizing chat/shared-trip warning accents.
- Replaced the generic landing feature-card grid with a mixed trip-planning workbench and concrete
  prompt chips that keep `/chat` prompt links intact.
- Redesigned the landing first viewport with a coastal photo overlay, compact trip-mode
  navigation, a `/chat` command affordance, roman H1 emphasis, and polished prompt copy.
- Refined the visual foundation with coastal paper, reef, caveat, alert, night-card, and lagoon CTA
  tokens, plus explicit shared button and badge transitions.
- Recorded the Hallmark audit redesign baseline, including pre-change quality gates and viewport
  notes for the landing, chat saved-plan, report, and shared-trip surfaces.
- Recorded final Clerk/auth implementation decisions and release-gate validation
  for the authenticated chat history, profile, ratings, and saved-trips plan.
- Changed saved-trip sync so signed-in users can claim unowned local saved trips,
  list owned saved items without `tripId`, and reuse their owned server trip id
  while anonymous saved-trip behavior remains compatible.
- Extended the user schema for Clerk identity caching, last-seen tracking, and soft deletion.
- Added authenticated saved-trip lookup indexes while preserving anonymous
  `client_trip_key_hash` compatibility.
- Documented the completed thin chat harness contract, including structured final payloads,
  selected artifacts, compact memory metadata, and source-free memory retrieval boundaries.
- Changed `/api/chat` observability to log selected and unselected artifact counts while keeping
  artifact-selection diagnostics and memory internals out of public responses.
- Changed structured final payload handling to validate model-selected memory files against
  current-turn memory observations and repair clear no-tool surf, beach, and source-policy answers
  by loading the exact indexed memory file first.
- Changed Ask Siargao agent prompt construction to include compact available-memory metadata before
  the loaded index while keeping full reference memory bodies out of the default prompt.
- Changed agent memory retrieval tool schemas to use the resolved turn memory catalog and return
  exact loaded memory filenames without exposing deployment metadata.
- Changed the Ask Siargao agent loop to parse structured final payload JSON, validate current-turn
  tool-call references, and keep legacy plain-text answers as no-artifact compatibility output.
- Changed chat runtime artifact handling so tool-produced cards, actions, and itineraries stay
  internal unless a final payload selects their artifact IDs.
- Documented saved trip sharing routes, anonymous local trip IDs, share-token behavior, and public
  shared-plan source/privacy boundaries in developer data and route references.
- Recorded the pre-implementation quality baseline for the Priority 11 Saved Trip Sharing plan.
- Completed the Priority 9 Weather, Tide, And Surf Fusion slice with condition judgments that use
  checked Open-Meteo weather, curated local caveats, and explicit unchecked tide, surf, road,
  current, and safety boundaries.
- Taught agent instructions, memory policy, and chat route intent signals to route weather-sensitive
  swimming, surfing, scooter, rain-plan, sunset, and boat-trip condition questions toward
  `get_condition_judgment` without replacing model-written final answers.

### Added

- Established Hallmark audit redesign progress tracking so each visual remediation step records
  validation results, status, and commit references.
- Added assistant response ratings with authenticated `/api/chat/ratings`
  upserts, owned assistant-message checks, accessible thumbs controls, and
  reload-hydrated selected state.
- Added authenticated chat thread APIs and signed-in `/chat` history controls for
  listing, hydrating, creating, renaming, archiving, deleting, and reloading
  owned conversation threads.
- Added authenticated `/api/chat` persistence for owned chat threads and
  user/assistant message rows while preserving anonymous stateless chat behavior.
- Added authenticated profile management with `/api/me/profile`, `/profile`,
  Ask Siargao travel preferences, immutable Clerk-owned identity fields, and
  browser coverage for persisted edits.
- Added Clerk webhook user sync and auth helper behavior, including verified
  `user.created`, `user.updated`, and `user.deleted` handling, local user
  upserts, last-seen tracking, and deleted-user anonymization.
- Added database tables for Ask Siargao user profiles, persisted chat threads,
  persisted chat messages, and assistant response ratings.
- Added Clerk auth shell integration with guarded `ClerkProvider` wiring, protected route
  proxy policy, prebuilt sign-in and sign-up pages, chat header auth actions, and route-policy
  coverage.
- Added Clerk environment variable references for publishable, secret, webhook, and redirect
  settings.
- Established progress and changelog tracking for the Clerk auth, session chat history,
  profile, ratings, and authenticated saved-trips implementation plan.
- Added compact Ask Siargao agent-memory metadata rendering so the model can discover reference
  files without loading their full bodies by default.
- Added progress tracking for the thin agent harness implementation so each plan step can record
  validation results, status, and commit references.
- Added chat share-link creation for saved trip items, including selected-item controls, API-backed
  share token creation, copy/open link controls, empty and error states, and browser coverage that
  verifies share requests exclude chat history and geolocation.
- Added public shared trip plan pages at `/trips/shared/[token]` with noindex metadata, selected
  card/itinerary rendering, source and caveat display, map links, generic unavailable-token
  handling, and server-render privacy coverage that excludes chat transcripts, raw provider
  payloads, and browser coordinates.
- Added saved trip API routes for browser sync, item deletion, share URL creation, and share-token
  lookup with validation, rate limiting, and route-level privacy coverage.
- Added Postgres-backed saved trip persistence and share-token storage, including hashed public
  tokens, expiry/deletion handling, migration parity coverage, and PGlite store tests.
- Added browser-local saved trip items in chat, including accessible card and itinerary save/remove
  controls, a compact saved-plan tray, reload persistence, deduping, and Playwright privacy
  coverage that excludes chat history and browser geolocation from saved payloads.
- Added shared saved-trip artifact contracts, runtime validators, browser storage DTOs, share
  request DTOs, and privacy regression tests for recommendation cards and itinerary plans.
- Established progress and changelog tracking for the Priority 11 Saved Trip Sharing
  implementation plan.
- Verified and documented the completed consent-based near-me geolocation flow, including granted,
  denied, skipped, and single-request-consumed browser permission coverage.
- Added browser-location source metadata for geolocated Places results, including tool-backed
  source-consistency validation that rejects fabricated browser-geolocation source claims.
- Added an optional chat composer location control that requests browser geolocation only after a
  traveler click, sends single-request location context with the next chat request, and consumes it
  afterward without storing coordinates.
- Added privacy-safe near-me Places center selection that uses consented browser geolocation for
  nearby searches, exposes the center source in tool data, and bypasses persistent chat-search
  caching for exact single-request browser coordinates.
- Added optional `/api/chat` browser geolocation client context with server-side validation,
  Siargao-area plausibility checks, and privacy-safe route metadata.
- Established progress and changelog tracking for the Priority 10 Consent-Based Near-Me
  Geolocation implementation plan.
- Exposed `get_condition_judgment` as a strict Responses agent tool with model-facing condition
  evidence, governed sources, provider-unavailable handling, and tool-loop audit coverage.
- Added a source-governed condition judgment builder that combines Open-Meteo weather, curated local
  caveats, and explicit unchecked tide, surf, road, current, and safety signals.
- Added condition judgment contract coverage for weather, tide, surf, road, and caveat signals,
  including future strict Responses schema validation for `get_condition_judgment`.
- Established progress and changelog tracking for the Priority 9 Weather, Tide, And Surf Fusion
  implementation plan.
- Added itinerary behavior coverage across agent tool-loop and browser rendering for rainy Cloud 9,
  sunset plus dinner, sandy beach/non-surfer, and food-crawl scenarios.
- Added chat UI rendering for itinerary artifacts, including sequenced stops, travel-time labels,
  map links, fallbacks, skip guidance, source caveats, and mobile containment coverage.
- Added `/api/chat` itinerary artifact responses with route coverage for rainy Cloud 9, sunset
  dinner, sandy beach half-day, and food-crawl prompts.
- Added weather and Google Places follow-up requirements to itinerary artifacts so rainy,
  weather-sensitive, meal, cafe, dinner, and food-crawl plans identify the live checks needed
  before final AI-written prose.
- Added a local itinerary planning agent tool with structured 2-4 hour plan artifacts, initial
  rainy Cloud 9, sunset dinner, sandy beach, non-surfer, and food-crawl theme support, and
  explicit unchecked weather, Places, surf, tide, road, closure, and safety caveats.
- Added a shared itinerary artifact contract for agent tool results and turn results, including
  sequenced stops, fallbacks, skip guidance, and source summaries.
- Established progress and changelog tracking for the Priority 8 Local Itinerary Builder
  implementation plan.
- Added Playwright coverage for map-first recommendation cards, including distance/open-status
  labels, Google Maps link behavior, prompt actions, mobile overflow, and markdown fallback.
- Added chat UI rendering for recommendation cards and follow-up actions beneath assistant
  markdown, including accessible map links and prompt action buttons.
- Added `/api/chat` response-shape coverage for structured cards, actions, markdown fallback
  compatibility, and optional artifact omission.
- Added curated beach recommendation cards and prompt actions with estimated ride times, Maps
  search links, source-backed fit reasons, and non-live caveats.
- Added Google Places recommendation cards and prompt actions with map links, distance/open-status
  labels, fit reasons, caveats, and live/fresh-cache source labels.
- Added tool-backed chat cards and actions to final agent turn results while keeping audit records
  restricted to safe metadata.
- Established progress tracking for the Priority 7 map-first recommendation cards implementation
  plan.
- Established progress and changelog tracking for the Priority 6 safe database and local
  knowledge tools implementation plan.
- Added safe local data tool contracts, an approved schema dictionary, and zod argument
  validation for schema discovery, structured local fact queries, and display-safe source
  evidence lookup.
- Added bounded structured local fact retrieval over curated beach guidance and approved
  database fact surfaces with source/confidence metadata and raw/private field guards.
- Added display-safe source evidence lookup for curated and governed fact IDs, including
  citation-policy handling, Google Places caveats, and restricted payload guards.
- Registered the safe local data tools in the Responses agent runtime with strict tool
  definitions, audit operation mapping, source summaries, and source-consistency coverage.
- Updated agent-memory guidance for safe local data tool use, structured filters, source
  evidence boundaries, and the memory-as-reference-not-evidence rule.
- Verified the Priority 6 safe database and local knowledge tools slice against format,
  lint, typecheck, database migration/seed, unit tests, production build, and restricted
  exposure checks.
- Added hosted file-search registration for synced agent memory plus a deterministic
  backend `search_agent_memory` fallback for local and test retrieval.
- Added agent-memory vector-store synchronization with dry-run support, checksum-aware
  file metadata, a package script, and server-only configuration documentation.
- Added reviewable agent-memory Markdown files with required-file validation, role
  classification, checksums, and deterministic memory version IDs.
- Established progress tracking for the Priority 5 persistent agent memory implementation plan.
- Established progress tracking for the Priority 4 AI tool runtime implementation plan.
- Added chat agent runtime contracts, audit/source aggregation helpers, future card/action
  metadata placeholders, and network-free test doubles for model/tool-loop tests.
- Added the chat agent tool registry with a strict source-policy tool, Zod argument validation,
  structured unknown/invalid tool errors, and machine-readable source label caveats.
- Added the weather forecast chat agent tool with governed Open-Meteo snapshots, location/date
  validation, normalized weather signals, and provider-unavailable tool outputs.
- Added governed Google Places search and details chat agent tools with cache-first lookup,
  allowed field masks, restricted output shaping, and provider-unavailable tool outputs.
- Added the curated local guide chat agent tool with structured beach candidates, filters, source
  summaries, and explicit unchecked local-condition caveats.
- Added the Responses API chat agent tool-loop runtime with `store: false` model calls, typed tool
  feedback, upstream request tracking, tool-call audit logs, source aggregation, and max-loop
  protections.
- Added chat source consistency validation for structured sources and rendered source lines so
  model-written answers cannot fabricate live, cached, weather, curated, or provider-unavailable
  source labels without matching tool evidence.
- Added chat agent runtime developer documentation covering tool extension, argument validation,
  provider-failure outputs, source summaries, observability, and remaining out-of-scope roadmap
  items.
- Established progress tracking for the Priority 3 trust score and source labels implementation
  plan.
- Added a shared answer source summary contract and compact markdown renderer for checked,
  not-checked, weather-signal, confidence, source-profile, and freshness labels.
- Established progress tracking for the Priority 2 contextual follow-up and request-scoped trip
  memory implementation plan.
- Added a shared request-scoped trip context and intent module for deriving stable Siargao context,
  active goals, and latest-turn follow-up modifiers without provider calls.
- Added route-level Priority 2 regressions for open-now, cheaper, nearby, rainy-day, beach-goal,
  ride-time, kids/no-scooter, missing-context, and generic guardrail follow-ups.
- Added normalized `LocalRecommendation` objects for Google Places-backed local recommendations,
  including map links, open-now status, fit reasons, caveats, and source freshness.
- Added a shared place-intent classifier for Priority 1 local recommendations, covering food,
  cafes, bars, activity places, services, specific places, live open-now and hours needs, nearby
  context, constraints, and named-place map-link prompts.
- Established progress tracking for the Priority 1 live local recommendation implementation plan.
- Established progress tracking for the Google Places persistence implementation plan.
- Added typed Google Places capture tables for identities, snapshots, details, reviews, freshness,
  retention, attribution, and migration parity.
- Added central Google Places field-mask, freshness, retention, reuse-state, and attribution policy
  helpers.
- Added a Google Places capture store for typed upserts, fresh lookups, normalized facts/evidence,
  review governance, and expired-content deletion.
- Added a Google Places retention cleanup job and `db:prune:google-places` script with dry-run
  support.
- Added a DB-first `AnswerContextStore` for bounded Google Places answer facts, source freshness,
  refresh gating, and gap reporting.
- Added end-to-end route coverage proving DB-first Google chat context, blocked-refresh gaps, and
  restricted Google content filtering before LLM input.
- Added a cached Google Places chat lookup path for recommendation answers, including persisted
  fresh search context and opening-hour signals.
- Added a logged local development stack workflow for host and Compose startup, database
  migration/seed steps, stack commands, and redacted command logging.
- Added curated Siargao beach guidance for grounded beach follow-up answers around General Luna,
  Cloud 9, sandy beaches, ride-time constraints, swimming, and sunset fit.
- Added Ask Siargao positioning and roadmap documentation focused on live local checks,
  weather-aware planning, place recommendations, map-first UX, and trust labels.
- Added mocked browser coverage for real chat submission, assistant response rendering, and prompt auto-submit.
- Established progress tracking for the real chat replacement plan.
- Added a first GPT-backed Ask Siargao chat slice with a server-side OpenAI Responses API adapter, `/api/chat` endpoint, rate limiting, validation, landing prompt deep links, and interactive desktop/mobile composers.
- Added explicit empty states to the admin diagnostics console for empty blocked-audit, completeness, provider/job, reviewer, LLM-cost, and drill-down datasets.
- Added shadcn primitives for sidebar, scroll area, avatar, input groups, button groups, toggles, items, empty states, breadcrumbs, collapsibles, and navigation menus.
- Established progress tracking for the shadcn/Panda migration plan.
- Added the Ask Siargao `/chat` workspace with desktop three-column context layout, mobile chat layout, mock conversation cards, and Playwright coverage.
- Added the landing and chat mockup implementation plan with step-by-step progress tracking.
- Added a repository-backed public-page generation boundary using persisted-page-shaped governed facts, public evidence bundles, and source fact IDs across human, Markdown, JSON, JSON-LD, sitemap, and `llms.txt` outputs.
- Added the first governed provider ingestion slice for local verified public-directory accommodation records, producing governed facts, evidence, and checkout-safe accommodation candidates.
- Added a GitHub Actions CI release gate for non-mutating Biome checks, TypeScript, Bun tests, database validation, production build, and Playwright e2e.
- Added release-candidate developer documentation for local setup, quality gates, environment variables, routes, demo data, audit lifecycle boundaries, provider limitations, and manual QA.
- Added a typed release-candidate demo scenario manifest and tests for synthetic or permitted local QA fixtures.
- Added sanitized observability events, privacy helpers, server-only secret handling, endpoint rate limits, security/noindex headers, and robots crawl rules.
- Added security tests for rate limiting, telemetry redaction, server-only secrets, public/private boundary enforcement, client-side secret absence, and crawl/noindex behavior.
- Added source-backed public knowledge surfaces for accommodations, areas, routes, operators, and risks, with human pages, LLM Markdown, JSON APIs, JSON-LD, sitemap, and `llms.txt`.
- Added public-surface tests proving human, Markdown, JSON, and JSON-LD outputs share the same facts and block private, raw, restricted, low-confidence, or weak-match content from publication.
- Added an environment-gated admin diagnostics console, diagnostics aggregation, redaction utilities, structured diagnostic log events, and operator drill-down views.
- Added admin diagnostics tests for production access gating, sensitive value redaction, blocked audit summaries, stale facts, provider errors, reviewer blocks, LLM cost estimates, job failures, and browser rendering without sample secret leaks.
- Added OpenAI Responses API adapter boundaries, controlled read-only retrieval tools, reviewer validation, mocked LLM coverage, and the final paid report page.
- Added report generation tests for unsupported data filtering, tool budgets, structured report parsing, deterministic validator failures, reviewer revision/block paths, and browser rendering of evidence-backed reports.
- Added Stripe Checkout session creation, verified webhook extraction, payment event records, audit lifecycle guards, background job primitives, and processing status UI.
- Added payment lifecycle tests proving checkout is gated, checkout returns do not unlock reports, webhook signatures are verified, generation starts only after verified payment, impossible publication states are rejected, and job failures preserve diagnostics.
- Added deterministic risk contracts, risk ranking, evidence bundle creation, stricter report schemas, and report publication validators.
- Added report validation tests for missing sections, invalid evidence, uncited accommodation claims, stale facts, payment-state violations, and low-confidence consequential claims.
- Added audit intake UI, `/api/audit/intake`, accommodation resolution, completeness gating, preview-risk generation, targeted refresh hooks, and checkout eligibility blocking.
- Added intake/completeness tests and a browser e2e submission for the minimum viable intake flow.
- Added source registry, provider adapter contracts, fact graph normalization, source/fact scoring, and conflict detection foundations.
- Added source governance tests for explicit source profiles, disallowed source rejection, allowed-use behavior, separate scoring records, and official-source precedence.
- Added the initial audit domain model with typed job states, risk/source/public visibility enums, report/intake validation schemas, and Siargao seed taxonomy.
- Added Drizzle/Postgres database setup, an initial SQL migration for the core fact graph and audit tables, and PGlite-backed migration/seed validation commands.
- Added tests for audit state transitions, schema validation, taxonomy coverage, and migration table coverage.
- Built the static Siargao Trip Risk Audit landing page with header, hero, risk preview, check grid, process section, trust band, sample report, testimonials, pricing/FAQ, and footer.
- Added a generated coastal dusk background image under `public/images/` and wired it into the global page background.
- Added landing-focused Panda tokens, recipes, local UI primitives, and Playwright checks for key sections, FAQ keyboard interaction, and responsive overflow.
- Scaffolded the Next.js App Router application with TypeScript, React, Panda CSS, and a minimal root page.
- Added Biome formatting and linting, Bun unit tests, Playwright e2e smoke tests, production build scripts, and development scripts.
- Added environment variable placeholders, dependency/build/test ignore rules, and generated Panda styling output.
- Established project progress tracking with `PROGRESS.md` and changelog tracking for the implementation plan.

### Changed

- Documented the itinerary planning tool contract, required weather/Places follow-up checks, and
  unchecked surf, tide, road, closure, and safety caveat boundaries in developer and agent memory
  docs.
- Recorded the pre-implementation quality baseline for the Priority 8 Local Itinerary Builder.
- Defined the structured chat recommendation-card contract around map-first place and beach fields
  while keeping prompt actions compatible with the roadmap response shape.
- Documented persistent agent memory authoring, sync, retrieval, source-policy constraints, and
  the legacy chat-adapter boundary.
- Loaded Markdown-backed agent memory into chat-agent instructions and exposed memory version
  metadata in runtime results, route responses, and logs.
- Routed valid `/api/chat` requests through the Ask Siargao agent runtime so weather, Places,
  local guide, scope-decline, missing-context, and provider-failure responses are model-written
  with structured tool/source metadata and source consistency validation.
- Expanded chat runtime regression coverage and observability so route/runtime logs include
  request IDs, model/tool metadata, provider-failure status, source labels, and source profile IDs
  without raw restricted provider payloads.
- Verified the Priority 3 trust/source label rollout against the roadmap and full release gate.
- Preserved normalized answer source lines in the chat UI, including metadata-rich Open-Meteo
  source lines that mention Cloud 9 without being split as numbered lists.
- Added not-verified source caveats to generic chat fallback responses and provider-unavailable
  caveats to failed Google Places recommendation lookups.
- Rendered Google Places recommendation source labels from provider freshness metadata, including
  distinct live/fresh-cache labels and opening-hours-not-verified caveats.
- Routed curated beach and weather chat answers through shared trust/source labels,
  including provider-unavailable caveats for fallback weather snapshots.
- Routed `/api/chat` follow-up decisions through request-scoped trip context for weather planning,
  beach guidance, ride-time limits, missing-reference clarification, and kids/no-scooter beach fit
  notes.
- Aligned Google Places place intent and recommendation planning with trip context so prior
  locations, cheaper modifiers, kids constraints, and open-now follow-ups shape search and ranking.
- Documented the request-scoped Priority 2 trip context boundary and persistence handoff for future
  trip and chat memory tables.
- Documented the completed Priority 1 local recommendation behavior, including cache-first Google
  Places lookups, markdown caveats, normalized recommendation objects, and the current e2e testing
  boundary.

### Fixed

- Prevented `describe_source_policy` from returning policy label descriptions as answer evidence,
  avoiding source-consistency failures when the policy tool is the only successful tool call.
- Removed the unsupported `origin` argument from the local-guide chat tool until origin-specific
  ride-time estimates exist; ride-time filtering now remains explicitly General Luna-side only.
- Rendered Priority 1 local recommendation answers with explicit `Checked:` and `Not checked:`
  caveats for Google Places signals, covered seating, bookings, review text, and local validation.
- Hardened Google Places chat-cache refresh behavior for partial fresh cache rows and live-status
  requests whose cached rows lack opening-hour status.
- Generalized the recommendation agent from food-only deterministic searches to Priority 1 local
  place searches, including open-now food, cafes, bars, activity places, service places, and
  specific-place identity/map-link lookups.
- Routed Priority 1 local-place chat requests through the recommendation agent with route coverage
  for open-now follow-ups, bar/drinks prompts, service-place prompts, covered/beachfront requests,
  and named-place map-link follow-ups.
- Restored `/api/chat` Google Places answer-context wiring for live/stored place facts and expanded
  recommendation detection to accommodation rating follow-ups near Cloud 9.
- Runs the checked-in SQL database migration during Compose startup after Postgres is healthy and
  before the app container starts serving.
- Routed `/api/chat` Google Places recommendation context through the DB-first
  `AnswerContextStore` dependency instead of direct provider lookup.
- Documented the Google Places persistence lifecycle, DB-first chat flow, retention pruning, and
  restricted-content operator limits.
- Constrained chat generation with a bounded answer-context contract for provider-specific facts,
  source freshness, attribution, and gaps.
- Made Google Places chat and details adapters capture-ready while preserving existing chat context
  compatibility.
- Optimized chat Google Maps link enrichment so existing linked URIs are detected reliably and
  missing map links are appended near matching place names.
- Bounded the client chat history sent to `/api/chat` by limiting prior completed turns and
  truncating long message content before follow-up requests.
- Routed food and place recommendation questions through the multi-step recommendation agent with
  request IDs, structured logs, provider-backed candidates, ranking, and fallback errors.
- Grounded weather-sensitive activity plans and beach follow-up answers in interpreted chat intent,
  live weather context when available, and local Siargao guidance before falling back to generic LLM
  responses.
- Changed `/chat?prompt=` deep links to prefill the composer without auto-submitting or clearing
  the prompt URL parameter.
- Wired weather-related `/api/chat` requests to Siargao Open-Meteo weather context, including direct live fallback when stored forecast rows are unavailable and Del Carmen area detection.
- Aligned landing-to-chat prompt links and copy with the GPT-only real chat surface, removing live-data and source-backed freshness claims from the landing shell.
- Replaced the `/chat` mock sidebar/context workspace with one focused responsive real chat shell.
- Completed final shadcn migration verification with Panda-free build/e2e gates and visual smoke checks across landing, chat, admin, status, public, and report surfaces.
- Updated package scripts, React Doctor config, Biome config, and developer docs for the Panda-free Tailwind/shadcn styling path.
- Migrated the paid report, admin diagnostics, public knowledge, and audit status surfaces from Panda helpers to shadcn/Tailwind classes and primitives.
- Migrated the Ask Siargao landing and chat workspace surfaces from Panda helpers to shadcn/Tailwind components.
- Migrated shared Ask Siargao primitives from Panda helpers to shadcn-backed Tailwind utilities.
- Moved Ask Siargao brand tokens into the Tailwind/shadcn CSS variable layer while keeping Panda available as a temporary fallback.
- Recorded the Panda-removal baseline inventory and confirmed planned shadcn migration primitives are available.
- Aligned route documentation, local QA docs, release-candidate checks, and site config regression coverage with the Ask Siargao landing and `/chat` surfaces.
- Replaced the audit-first root landing page with the Ask Siargao mockup landing experience, including the prompt card, weather card, suggestion chips, trust row, feature cards, and updated root e2e coverage.
- Reframed the shared app shell metadata, dark coastal background, brand tokens, and reusable Ask Siargao UI primitives for the landing and chat mockups.

### Deprecated

### Removed

- Removed completed `PLAN.md`, `PROGRESS.md`, and old implementation plan files after consolidating
  current product direction into roadmap documentation.
- Removed Panda CSS configuration, generated `styled-system` output, Panda theme token/recipe files, Panda codegen scripts, `postinstall`, and the `@pandacss/dev` dependency.

### Fixed

- Kept recommendation-agent candidate state consistent across planner steps so newly found places
  are available to ranking and final-answer rendering.
- Rendered assistant chat Markdown for bold text and bullet lists instead of collapsing formatted responses into a plain paragraph.
- Hoisted the chat timestamp formatter so message rendering does not rebuild `Intl.DateTimeFormat` for every timestamp.
- Hardened chat pending and error states with disabled in-flight controls, safe failure copy, retry affordance, and keyboard resubmission coverage.
- Improved admin and public outline badge contrast after final visual inspection.
- Added explicit sidebar rail button type and migrated the sidebar context read to the React 19 `use(context)` API.
- Returned stable `invalid_json` responses for malformed audit intake request bodies while preserving schema-level `invalid_intake` errors.
- Computed evidence freshness against the current clock so expired facts become stale and invalid expiry values remain unknown.
- Required paid report validation to cover every mandatory risk category in the full risk table while keeping top risks as a ranked subset.
- Added an injectable rate-limit store path, local expiry cleanup, and opt-in trusted-proxy identity handling so spoofed forwarding headers do not bypass limits by default.
- Allowed audit intake to use a selected arrival route when the free-text origin is absent.
- Moved API route test helpers out of Next route modules so production builds validate App Router exports.
- Derived public-page republication eligibility from registered source policy, blocking citation-only official facts from public answer-engine surfaces.
- Scoped controlled retrieval evidence IDs to the facts selected by each tool so unrelated evidence cannot be returned with route or accommodation facts.
- Required signed-token access plus paid, published, reviewer-approved state before rendering private audit reports, with the sample report moved to an explicit demo route.
- Applied verified Stripe checkout webhooks to the persisted audit/payment lifecycle with duplicate-event idempotency and generation job enqueueing.
- Loaded audit checkout eligibility from persisted server-side audit, completeness, and payment state instead of trusting client-supplied lifecycle fields.
- Kept the typed Drizzle schema exports in parity with the initial SQL migration, including candidate matching, scoring, refresh, LLM tool-call, provider-health, and public-page generation tables.

### Security
