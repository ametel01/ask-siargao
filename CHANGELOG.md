# Changelog

All notable functional changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning when releases are tagged.

## [Unreleased]

### Added

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

### Changed

- Enforced required public web research before dependent Places, weather, or nightlife enrichment;
  dependent enrichment is skipped when required research returns terminal insufficient or
  unavailable evidence.
- Converted Google Places for research-covered prompts into research-selected entity enrichment so
  broad Places candidates are not shown as fallback recommendation cards.
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

### Removed

- Removed legacy fallback acceptance for research-required prompts: broad Places, weather-only, and
  memory-only answers are rejected unless current public web evidence is successful or the answer
  transparently states that it could not be verified.

### Fixed

- Fixed the OpenAI web research structured-output schema so strict result and nested entity
  properties are required with nullable optional values instead of schema-invalid omissions.
- Kept provider-unavailable public web research in the same transparent, card-free failure path as
  insufficient evidence.
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
- Generalized the recommendation agent from food-only searches to open-now food, cafes, bars,
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
