# Changelog

All notable functional changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning when releases are tagged.

## [Unreleased]

### Changed

- Simplified the 14-day Siargao Trip Pass to a `$9.99` USD, 150-travel-answer product, with 10 free
  answers over seven days and automatic evidence tools instead of customer-facing live, research,
  weather, or route allowances. Existing version 1 grants remain readable for ledger continuity.
- Changed public Ask Siargao positioning to show the catalog-backed Trip Pass launch price, free and
  paid limits, Siargao-specific advantages, and legal/support boundaries before checkout.
- Changed authenticated paid chat live-tool execution to meter Trip Pass live, heavy, weather, and
  route decisions once per request category, release failed or cache-only provider attempts, and
  return typed `live_access_required` tool outcomes for governed cached/local fallback.
- Changed authenticated paid chat to reserve and settle Trip Pass `chat_message` usage
  server-side, returning typed `usage_limit_reached` exhaustion before model execution and
  preserving exactly-once settlement for idempotent successful requests.
- Changed DeepSeek chat runtime behavior behind `DEEPSEEK_COST_POLICY_ENABLED` so routine free and
  paid turns use bounded non-thinking requests, paid heavy turns retain thinking-high, and OpenAI
  fallback is disabled for free traffic.

### Security

- Added Trip Pass perimeter and cost controls, including authenticated account-velocity challenges,
  trusted-ingress cohort handling, request idempotency token binding, and provider/global model
  budget circuits before expensive model work.
- Added privacy-safe anonymous reset resistance for free chat usage, including signed trip
  identities, HMAC network cohorts, challenge outcomes for suspicious cleared-cookie velocity, and
  production fail-closed behavior without Redis.
- Added shared async quota-store enforcement for rate limits and future product controls, including
  production fail-closed behavior when a shared store is unavailable and Redis-backed fixed-window,
  rolling-reservation, concurrency-lease, idempotency, and budget primitives.
- Required verified Stripe webhook events matched to local Trip Pass orders before activation, with
  idempotent paid, failed, expired, refund, and dispute lifecycle handling.

### Added

- Added on-demand accommodation Reality Checks that verify named-property identity, compare
  governed area fit against traveler constraints, bound unverified property qualities, request
  focused missing context, and suppress unrelated place cards or positive verdicts after provider
  failure.
- Added on-demand Siargao Reality Check verdicts with server-validated evidence references,
  source-derived decision summaries, bounded repair and provider-failure downgrade behavior,
  authenticated history compatibility, strict artifact selection, and privacy-safe outcome
  telemetry.
- Added an executable Trip Pass launch-proof artifact and release-candidate runbook covering
  free-to-paid lifecycle evidence, approval blockers, external smoke lanes, and flag-based rollback.
- Added redacted Trip Pass reconciliation and support diagnostics for paid-order, pass, grant,
  usage-meter, provider-request, price-catalog, sink, store, and cost-circuit recovery checks.
- Added privacy-safe Trip Pass funnel, meter, and model-cost analytics delivery through an
  allowlisted PostHog-compatible sink, DNT-aware pricing-view beacon, and operator event matrix.
- Added traveler-facing Trip Pass status surfaces in settings and mobile chat, including
  account-scoped allowance, expiry, pending checkout, unavailable, warning, and checkout-return
  handling without local activation controls.
- Added end-to-end free Trip Pass chat decision metering so anonymous and signed-in no-pass
  travelers get the seven-day 10-chat, 3-live, and 1-heavy trial with burst, concurrency, reset, and
  sign-in transition protections before upgrading.
- Added a Vercel WAF log-mode runbook for Trip Pass chat, checkout, and auth-entry perimeter rules,
  including promotion criteria, rollback, and privacy-safe verification evidence.
- Added anonymous Trip Pass free-allowance enforcement for chat, including Secure/HttpOnly/SameSite
  trip cookies, seven-day and daily success windows, minute starts, per-actor concurrency, and
  local-development cookie behavior.
- Added owner-scoped Trip Pass status and checkout APIs for signed-in travelers, including protected
  account routes, private no-store responses, sanitized checkout failure handling, and redacted pass
  allowance presentation.
- Added authenticated Trip Pass Checkout order creation with duplicate-click idempotency, Stripe
  Price validation, and webhook-only activation boundaries.
- Added a durable Trip Pass order, grant, and usage-event ledger plus server entitlement decisions
  with idempotency keys, provider-key snapshots, validity checks, and migration coverage for
  checkout and meter evidence.
- Added redacted request-scoped model-cost telemetry, DeepSeek usage normalization, and a Trip Pass
  cost-baseline runner for operator unit-economics evidence.
- Added a server-owned Trip Pass product catalog with disabled checkout, extension, DeepSeek
  cost-policy, anonymous identity, Redis, analytics, fallback, WAF, and cost-budget configuration
  states.
- Added private settings dashboard summaries for recent signed-in chat threads and saved planning
  items without exposing full chat transcripts.
- Added a protected `/settings` route for signed-in Ask Siargao user settings.
- Added configurable public web research through `research_web`, including source-backed output,
  insufficient-evidence responses, provider-unavailable responses, query planning, source scoring,
  finding extraction, entity hints, and required-evidence planning for current recommendations,
  schedules, availability, prices, safety/disruption, and comparison prompts.
- Added authenticated chat history, conversation thread management, assistant response ratings,
  Clerk-backed profile management, Clerk user sync, and persisted chat/profile/rating tables while
  preserving anonymous stateless chat behavior.
- Added saved-trip persistence, browser-local saved items, authenticated saved-trip sync,
  share-link creation, public shared trip pages, share-token storage, and saved-trip API routes for
  sync, deletion, share URL creation, and share-token lookup.
- Added consent-based near-me behavior with an optional chat composer location control,
  single-request browser geolocation context, privacy-safe nearby Places center selection, and
  geolocated Places source metadata.
- Added weather, tide, surf, road, current, and safety condition judgments through
  `get_condition_judgment`, combining Open-Meteo weather, curated local caveats, explicit unchecked
  marine/road/safety boundaries, and provider-unavailable handling.
- Added structured local itinerary artifacts for rainy Cloud 9, sunset dinner, sandy beach
  half-day, non-surfer, and food-crawl prompts, including sequenced stops, travel-time labels, map
  links, fallbacks, skip guidance, source summaries, and required weather/Places follow-up checks.
- Added map-first recommendation cards and prompt actions for curated beach and Google Places
  recommendations, including map links, distance/open-status labels, fit reasons, source-backed
  caveats, and live/fresh-cache source labels.
- Added safe local knowledge tools for schema discovery, bounded local fact retrieval, and
  display-safe source evidence lookup with approved surfaces, source/confidence metadata,
  citation-policy handling, and raw/private field guards.
- Added persistent agent memory discovery and retrieval so chat can use compact memory metadata,
  synchronized reference files, and bounded `search_agent_memory` results without exposing full
  reference bodies by default.
- Added the Ask Siargao chat agent runtime with strict tool registration, weather, Google Places,
  curated local guide, source-policy, safe local data, and public web research tools, plus structured
  source summaries and model-written provider-failure responses.
- Added trust and source labels for checked, not-checked, weather-signal, confidence,
  source-profile, freshness, provider-unavailable, live, and fresh-cache answer lines.
- Added request-scoped trip context and intent handling for follow-up modifiers, weather planning,
  beach guidance, ride-time constraints, missing-context clarification, cheaper/nearby/open-now
  follow-ups, and kids/no-scooter beach fit.
- Added Google Places persistence with typed capture tables, field-mask and retention policy
  helpers, cache-first lookup, DB-first answer context, normalized recommendation facts, freshness
  signals, and retention cleanup.
- Added curated Siargao beach guidance for grounded follow-up answers around General Luna, Cloud 9,
  sandy beaches, ride-time constraints, swimming, and sunset fit.
- Added the GPT-backed Ask Siargao chat surface with `/api/chat`, rate limiting, landing prompt deep
  links, and interactive desktop/mobile composers.
- Added public knowledge surfaces for accommodations, areas, routes, operators, and risks across
  human pages, Markdown, JSON APIs, JSON-LD, sitemap, and `llms.txt`.
- Added the trip-risk audit flow with intake, accommodation resolution, completeness gating,
  preview-risk generation, checkout eligibility, Stripe Checkout, verified webhook handling, report
  generation, paid report access, sample report access, audit lifecycle guards, processing status,
  and background job primitives.
- Added governed provider ingestion, source registry, fact graph normalization, source/fact scoring,
  conflict detection, risk ranking, evidence bundles, stricter report schemas, and report
  publication checks.
- Added an environment-gated admin diagnostics console with redacted summaries for blocked audits,
  completeness, provider/job status, reviewer status, LLM cost, stale facts, and drill-down views.
- Added production database authorization guidance with tested runtime, migration, and reporting
  role/grant SQL templates, credential-boundary documentation, and an explicit row-level security
  deferral decision record.
- Added database hardening constraints and supporting foreign-key indexes across provider/source
  graphs, Google Places, audit/payment/report, refresh, public page, LLM, reviewer, provider
  health, and public generation job tables.
- Added additive hot-path database indexes for chat history, saved trips, public fact/evidence
  reads, and Google Places chat-cache freshness lookups, plus read-only operator SQL for duplicate
  and unused index review.
- Added normalized public-page fact and evidence relationship tables with ordered backfill from
  legacy JSON arrays while preserving legacy catalog fallback compatibility.

### Changed

- Changed shared product surfaces across landing, chat, and settings to use restrained panel, inset,
  overlay, and line-item roles with clearer typography, flatter recommendation grouping, and
  committed before/after visual evidence at mobile and desktop widths.
- Changed the desktop chat workspace into a restrained Siargao field desk with a dominant
  conversation surface, subordinate travel rails, coastal brand cues, and viewport-safe layouts.
- Changed chat history and saved planning summaries to open actionable owned content with typed
  rename/archive/delete controls, authoritative empty-state handling, and race-safe selection.
- Changed recommendation artifacts to a route-first, fit-ranked presentation with bounded
  alternatives, backed signals, map actions, no-photo fallbacks, and explicit card selection authority.
- Changed source presentation to use an expandable traveler evidence receipt with checked and
  not-checked boundaries, freshness, friendly labels, and terminal-gap card suppression.
- Changed evidence presentation to distinguish capability, checking, checked, stale, unavailable,
  and not-verified states across landing, chat, decision strips, and shared-trip surfaces.
- Changed chat location sharing to use one accessible privacy control with explicit once/trip
  consent, truthful failure states, race-safe capture, and request-scoped coordinate handling.
- Changed suggested questions to use deterministic, truthful trip context and condition availability
  while providing concise onboarding prompts when traveler context is not yet known.
- Changed newly completed decision strips to reveal a restrained, reduced-motion-safe arrival cue
  without replaying on hydration, focus, or scroll.
- Changed privacy settings to provide owner-scoped, transactional travel-data controls with
  deliberate confirmations, share invalidation, safe audit metadata, and truthful location/consent states.
- Changed assistant waiting to use honest indeterminate progress with safe stop/retry behavior,
  stale-request guards, and lifecycle-safe thread/location transitions.
- Changed chat to expose a truthful mobile trip-context surface, shared live-condition decisions,
  privacy-safe location scope, resilient draft saves, and responsive accessibility states.
- Changed the landing page into a responsive mobile-to-desktop story with real navigation,
  truthful capability labels, encoded chat handoff, and robust keyboard focus treatment.
- Changed the settings account surface to expose traveler-safe identity and account-management
  controls without returning authentication-provider identifiers or fallback identity emails.
- Changed profile settings to use accessible structured travel controls with stable values,
  legacy-value preservation, diff-only saves, and serialized request handling.
- Changed `dev:up` to wait for the Compose Postgres healthcheck before running migrations so fresh
  local database volumes do not race startup.
- Changed default chat final-answer guidance to favor traveler-facing Markdown over JSON wrappers,
  with larger response budgets and a repair retry for malformed internal-looking output.
- Changed chat artifact selection so free-form answers can display safe backend tool-result cards
  when the answer names the card, without requiring model-authored JSON metadata.
- Fixed persisted chat metadata so sources, cards, tool calls, and context summaries are stored as
  JSONB arrays or objects instead of JSONB string scalars.
- Fixed the malformed chat-output guard to stay compatible with the app's ES2017 TypeScript
  target.
- Changed Google Places retention pruning to check expired review cleanup before deleting dependent
  details and snapshots.
- Redesigned the settings dashboard layout so account details, private planning summaries, and
  travel profile editing use the full app workspace instead of a narrow centered page.
- Added a visible top-bar Settings control in the chat workspace so account settings are not hidden
  behind the Clerk avatar.
- Changed in-app settings/profile navigation and route docs to treat `/settings` as canonical while
  preserving `/profile` compatibility.
- Changed the profile settings surface into a broader settings dashboard while preserving travel
  profile editing and the `/profile` compatibility route.
- Retired the legacy recommendation-agent module so local recommendation behavior now lives only in
  the Ask Siargao chat tool loop and evidence policy.
- Moved chat evidence final-payload enforcement and required-card exposure behind a chat evidence
  policy module instead of keeping those decisions in the turn loop.
- Moved governed Google Places evidence lookup, cache/live selection, stored detail reuse, and live
  detail enrichment behind a provider-owned evidence module.
- Moved audit intake checkout eligibility into one checkout-readiness decision so routes receive a
  payment-ready decision instead of coordinating accommodation resolution and completeness results.
- Moved vehicle-rental chat evidence repair into the required-evidence policy so the turn runtime
  gets Places-first lookup and public-web fallback requirements from one policy surface.
- Deepened required-evidence repairs so policy code now owns repair tool-call construction,
  targeted fallback argument matching, and Places-card acceptance instead of the chat runtime.
- Moved Google Places chat capture construction into a governed capture module so cache callers
  pass provider observations instead of assembling source records, snapshots, retention windows,
  and attribution payloads themselves.
- Moved public chat turn assembly into a shared module so `/api/chat` delegates public message
  repair, source validation, artifact exposure, and stored-history tool-call projection to one
  response boundary.
- Moved Google Places search/detail provider routing behind a Places evidence adapter so chat tools
  format tool results without owning live, cache, no-store, DB, and enrichment selection rules.
- Hid private audit, payment, publication, and reviewer state behind report-access decision records
  so routes and tests exercise the access policy without reconstructing persisted state matrices.
- Strengthened chat source governance so `provider_unavailable` labels cannot carry checked facts
  and recommendation cards from failed provider outputs are excluded from selection.
- Strengthened chat agent instructions and tool descriptions so the model owns tool choice and
  natural-language query formulation, including local service lookups and provider-failure recovery.
- Changed chat provider-failure handling so failed `research_web` or `search_places` calls stay in
  the model-visible tool transcript and successful evidence from another provider can still shape
  the final answer.
- Reduced `/api/chat` model-facing deterministic signals to safe client context, safe conversation
  context, and scope flags instead of route-derived intent and tool-routing hints.
- Changed saved-trip sync so signed-in users can claim unowned local saved trips, list owned saved
  items without `tripId`, and reuse their owned server trip id while anonymous saved-trip behavior
  remains compatible.
- Changed `/api/chat` final payload handling so tool-produced cards, actions, and itineraries stay
  internal unless the final answer selects their artifact IDs.
- Changed agent memory retrieval to use the resolved turn memory catalog and return exact loaded
  memory filenames without exposing deployment metadata.
- Routed weather-sensitive swimming, surfing, scooter, rain-plan, sunset, and boat-trip condition
  questions toward condition judgments without replacing model-written final answers.
- Routed valid `/api/chat` requests through the Ask Siargao agent runtime so weather, Places, local
  guide, scope-decline, missing-context, and provider-failure responses are model-written with
  structured tool/source metadata.
- Routed curated beach and weather chat answers through shared trust/source labels, including
  provider-unavailable caveats for fallback weather snapshots.
- Aligned Google Places place intent and recommendation planning with trip context so prior
  locations, cheaper modifiers, kids constraints, and open-now follow-ups shape search and ranking.
- Replaced the audit-first root landing page with the Ask Siargao landing experience, prompt links,
  suggestion chips, trust row, feature cards, and route behavior.
- Replaced the `/chat` mock sidebar/context workspace with one focused responsive real chat shell.
- Routed `/api/chat` Google Places recommendation context through the DB-first
  `AnswerContextStore` dependency instead of direct provider lookup.
- Bounded the client chat history sent to `/api/chat` by limiting prior completed turns and
  truncating long message content before follow-up requests.
- Changed `/chat?prompt=` deep links to prefill the composer without auto-submitting or clearing
  the prompt URL parameter.
- Aligned landing-to-chat prompt links and copy with the GPT-only real chat surface, removing
  live-data and source-backed freshness claims from the landing shell.
- Changed Postgres app, CLI, and job clients to use shared environment-driven connection options
  with explicit pool, timeout, lifetime, SSL, statement-timeout, and `prepare: false` settings.
- Changed database migrations to use a `schema_migrations` ledger with checksums, skipped repeat
  runs, drift detection, transactional application where safe, and a deterministic Postgres
  advisory lock.
- Bounded database-backed chat thread and public catalog list reads with default caps, bounded
  custom limits, deterministic chat thread cursor pagination, and capped public page fact/evidence
  hydration.
- Changed saved-trip item, Google Places review/fact/evidence, and Open-Meteo fact graph writes to
  use bounded multi-row conflict-aware batches while preserving existing ordering and transaction
  behavior.
- Changed Google Places retention pruning to use bounded batch deletes, dry-run and batch controls,
  count-only progress output, and review cleanup completion before snapshot cleanup.

### Removed

- Removed stale deterministic route-intent handling from the chat agent runtime so condition and
  itinerary repairs infer from traveler text and safe context instead of classifier-owned tool
  categories.
- Removed automatic route-classifier evidence repair and preflight injection from the chat agent
  runtime so it no longer synthesizes `auto_required_evidence_*` tool calls.
- Removed route-derived required evidence planning so deterministic classifier signals no longer
  manufacture mandatory `research_web`, `search_places`, weather, or nightlife event calls.

### Fixed

- Kept public sitemap and LLM index routes available when the optional database-backed public
  catalog is temporarily unreachable.
- Scoped public API rate limiting by route path so high-volume weather or surf checks do not block
  unrelated public catalog JSON.
- Restored one-request browser-location capture for near-me chat prompts without requiring the
  traveler to open the location control first.
- Tolerated model-style `research_web` arguments with omitted nullable fields or snake_case aliases
  so valid web-research requests no longer fail chat with repeated `invalid_tool_arguments`.
- Made the chat right-hand trip context rail fixed and vertically compact so only the chat message
  area scrolls on desktop.
- Kept the chat trip-context rail visible at normal desktop browser widths instead of only showing
  it after zooming out.
- Allowed public machine-readable document routes such as `robots.txt`, `sitemap.xml`, and
  `llm.md` to bypass Clerk middleware while API routes remain covered.
- Fixed the OpenAI web research structured-output schema so strict result and nested entity
  properties are required with nullable optional values instead of schema-invalid omissions.
- Prevented dependent required-evidence checks from running before required web research evidence is
  available.
- Required public web-research labels to be backed by successful `research_web` tool evidence.
- Preserved loaded nightlife memory baselines when current event lookup has no matching event facts,
  so nightlife recommendation answers no longer collapse to weather-only or generic Places
  fallbacks.
- Prevented Dapa breakfast answers from exposing unrelated beach cards when multiple successful tool
  calls produce mixed artifact types.
- Kept shared-trip public source freshness, checked/not-checked signals, source labels, open-status
  labels, map links, areas, and caveats visible with not-reverified caveats.
- Corrected boat, Sugba, beach, scooter, temporal, and named-location condition judgment routing so
  condition answers use the relevant weather, marine, route, and caveat evidence.
- Rejected fabricated checked road, safety, official-warning, tide, and surf claims before matching
  provider-backed tools exist.
- Kept itinerary artifacts aligned with required weather and Places evidence, true open-now checks,
  user constraints, origin-sensitive route timing, high-weather-risk fallbacks, and final prose
  source caveats.
- Preserved returned Google Places detail hours, rating, rating-count, and price signals in live
  detail cards and model-facing tool text.
- Prevented safe local source evidence lookup from returning audit-only/private metadata,
  fabricated curated guide fact IDs, expired facts, expired source evidence, or unrelated route
  facts.
- Tightened safe local fact queries to exclude non-display-safe source profiles, search area/text
  filters independently, return public entity registry rows, and time out slow database calls.
- Removed server-only memory deployment metadata from public chat responses, model-facing prompts,
  and memory-search tool payloads.
- Prevented `describe_source_policy` from returning policy label descriptions as answer evidence.
- Hardened Google Places chat-cache refresh behavior for partial fresh cache rows and live-status
  requests whose cached rows lack opening-hour status.
- Generalized local place evidence planning from food-only searches to open-now food, cafes, bars,
  activity places, service places, and specific-place identity/map-link lookups.
- Restored `/api/chat` Google Places answer-context wiring for live/stored place facts and expanded
  recommendation detection to accommodation rating follow-ups near Cloud 9.
- Optimized chat Google Maps link enrichment so existing linked URIs are detected reliably and
  missing map links are appended near matching place names.
- Grounded weather-sensitive activity plans and beach follow-up answers in interpreted chat intent,
  live weather context when available, and local Siargao guidance before falling back to generic LLM
  responses.
- Rendered assistant chat Markdown for bold text and bullet lists instead of collapsing formatted
  responses into a plain paragraph.
- Hardened chat pending and error states with disabled in-flight controls, safe failure copy, retry
  affordance, and keyboard resubmission behavior.
- Returned stable `invalid_json` responses for malformed audit intake request bodies while
  preserving schema-level `invalid_intake` errors.
- Computed evidence freshness against the current clock so expired facts become stale and invalid
  expiry values remain unknown.
- Required paid report validation to cover every mandatory risk category in the full risk table
  while keeping top risks as a ranked subset.
- Added opt-in trusted-proxy identity handling so spoofed forwarding headers do not bypass rate
  limits by default.
- Allowed audit intake to use a selected arrival route when the free-text origin is absent.
- Derived public-page republication eligibility from registered source policy, blocking
  citation-only official facts from public answer-engine surfaces.
- Scoped controlled retrieval evidence IDs to the facts selected by each tool so unrelated evidence
  cannot be returned with route or accommodation facts.
- Required signed-token access plus paid, published, reviewer-approved state before rendering
  private audit reports.
- Applied verified Stripe checkout webhooks to the persisted audit/payment lifecycle with
  duplicate-event idempotency and generation job enqueueing.
- Loaded audit checkout eligibility from persisted server-side audit, completeness, and payment
  state instead of trusting client-supplied lifecycle fields.

### Security
- Added saved-trip owner checks so authenticated delete and share attempts for another user's saved
  trip return `404` and public share DTOs omit owner, profile, chat, provider payload, and
  geolocation data.
- Stored authenticated chat history keeps browser geolocation as summaries without exact
  coordinates and persists tool-call summaries without raw arguments.
- Prevented memory retrieval from backing checked, provider, curated, or provider-unavailable
  source labels, and validates selected card sources before returning public chat responses.
- Hardened shared-trip public DTOs so they preserve allowed source metadata while rejecting raw
  provider payloads, Google review fields, tool-call arguments, full chat transcripts, browser
  geolocation, and exact coordinates.
- Added sanitized observability events, privacy helpers, server-only secret handling, endpoint rate
  limits, security/noindex headers, and robots crawl rules.
