# Ask Siargao Product Roadmap

## Purpose

This roadmap turns the positioning in [ASK_SIARGAO_POSITIONING.md](ASK_SIARGAO_POSITIONING.md) into an implementation plan.

Ask Siargao should not compete as a general chatbot. It should become the Siargao trip copilot that helps a traveler decide what to do next through an AI agent that can retrieve local context, live place data, weather, distance, and source caveats on demand.

## Product Promise

Ask Siargao gives practical, current trip decisions for Siargao by letting an AI agent retrieve live local data, read curated Siargao knowledge, and explain the best next move in plain language.

## Roadmap Principles

- Every chat request must go through the AI, and every user-facing answer must be AI-written.
- The backend is a tool runtime, not the final conversational layer.
- Deterministic code may classify, retrieve, rank, validate, and enforce source policy, but it must not replace the model's final response with preset prose.
- The AI should decide when to call tools for weather, Places, curated local knowledge, database facts, and source inspection.
- Treat Google Places and Open-Meteo as governed providers with field masks, freshness windows, retention rules, and source caveats.
- Treat nightlife as event-first, venue-second: event sources establish what is
  happening, while Google Places enriches selected venues.
- Keep local Siargao curation as structured data and expose it to the AI through tools or retrieval memory.
- Give the AI persistent product memory through Markdown instructions, file search/vector stores, or backend tools.
- Return answers that a traveler can act on: place, distance, open signal, map link, reason, caveat, and fallback.
- Make follow-ups inherit stable trip context while allowing the latest modifier to change the answer goal.

## Current Implementation Baseline

The repo already has useful foundations for this roadmap, but Priorities 1-3 also showed the main product risk: too much user-facing behavior can be fulfilled by deterministic branches before the AI writes anything.

Milestone 4 onward should correct that direction. The foundations remain useful as tools and retrieval systems, not as preset answer renderers:

- `src/app/api/chat/chat-route.ts` classifies food, beach, weather, nearby, and activity-plan intents.
- `src/server/chat/recommendation-agent.ts` routes food and place-like questions through a planner, Google Places lookup, ranking, and rendered answer.
- `src/server/providers/google-places-chat.ts` performs Places Text Search with a controlled field mask.
- `src/server/providers/google-places-chat-cache.ts` checks fresh cached Google Places rows before calling the live provider and persists live results.
- `src/server/local/siargao-beaches.ts` contains deterministic curated beach guidance with ride-time, surface, use-case, tide-note, and caveat fields.
- `src/server/providers/open-meteo.ts` and `src/server/public-pages/weather-snapshot.ts` provide weather forecast ingestion and chat-ready snapshots.
- `docs/agent-memory/` provides request-routed local knowledge; nightlife needs
  its own memory file instead of relying on generic bar/place assumptions.
- `src/features/chat/ChatWorkspace.tsx` renders assistant markdown, links, source lines, and a chat composer.
- `src/server/db/schema.ts` already includes source-governance, fact, evidence, Google Places, weather, public content, and payment-related tables.

The roadmap should preserve these systems as backend capabilities while moving final response ownership to an AI tool-calling agent.

## Priority 1: Live Open-Now Local Recommendations

### Outcome

When a traveler asks for restaurants, cafes, drinks, covered places, beachfront places, specific places, nearby options, or open-now guidance, Ask Siargao should automatically use Google Places or fresh cached Places rows and avoid generic local-place prose.

### User Stories

- As a traveler near Cloud 9, I can ask "where can I eat nearby that is open now?" and receive current options with map links and source caveats.
- As a traveler planning dinner, I can ask "is this still open?" after a restaurant answer and get a live-status answer without restating the restaurant or area.
- As a traveler in bad weather, I can ask for "covered cafes nearby" and get options filtered toward covered/indoor suitability when available, with an explicit caveat when coverage was inferred or not verified.

### Technical Specification

Extend `ChatRequestIntent` in `src/app/api/chat/chat-route.ts` and `FoodRequestIntent` in `src/server/chat/recommendation-agent.ts` into a shared place-intent model:

```ts
type PlaceIntent = {
  category:
    | "food"
    | "coffee"
    | "bar"
    | "activity_place"
    | "service"
    | "specific_place";
  liveNeed: "open_now" | "hours" | "nearby" | "identity" | "recommendation";
  locationLabel?: string;
  placeName?: string;
  constraints: string[];
  avoid: string[];
  radiusMeters: number;
};
```

Route all `PlaceIntent` requests through `RecommendationAgent` or a renamed `PlaceRecommendationAgent`. The deterministic planner should choose a Places search before the LLM planner when:

- the latest user turn includes `open now`, `open today`, `currently open`, `hours`, or `nearby`;
- the latest user turn is a follow-up and recent context contains a place category;
- the request asks about a specific local place identity or map link;
- the answer would name local businesses, clinics, pharmacies, scooter rentals, laundry, or ATMs.

Keep the DB-first path in `createDefaultCachedGooglePlacesChatContextAdapter`. A live provider call should happen only when the cache has fewer than the configured minimum fresh rows, cached rows are stale, or the user asks for live status that cached rows cannot support.

Normalize all returned candidates to one internal card shape:

```ts
type LocalRecommendation = {
  id: string;
  name: string;
  category: string;
  mapsUrl: string;
  distanceMeters?: number;
  openNow?: boolean;
  businessStatus?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  fitReasons: string[];
  caveats: string[];
  source: {
    provider: "Google Places";
    fetchedAt: string;
    freshness: "live" | "fresh_cache" | "stale_cache";
  };
};
```

The text renderer can initially produce markdown from this object. Priority 4 should move the same object into UI cards.

### Data And Provider Requirements

- Reuse `google_places`, `google_place_snapshots`, and `google_place_details`.
- Continue using the Google Places chat field mask from `google-places-policy`.
- Store Place ID as durable identity and keep raw payload retention bounded by the existing Google Places store policy.
- Do not store or display raw reviews as durable product data unless source policy explicitly allows it.

### Acceptance Criteria

- Food, cafe, bar, covered-place, beachfront-place, and specific-place prompts no longer fall through to generic LLM answers when a provider lookup is required.
- Open-now follow-ups use recent context to infer category and area.
- Each answer includes map links when Google returns them.
- Each answer includes "Checked" and "Not checked" caveats.
- Provider failure returns a bounded unavailable response instead of fabricated local options.

### Test Plan

- Add route tests in `src/app/api/chat/route.test.ts` for open-now, nearby, covered cafe, and specific-place follow-ups.
- Add recommendation-agent tests for deterministic `PlaceIntent` routing and cache-backed answers.
- Add Google Places cache tests for stale rows, partial cache rows, and live refresh fallback.

## Priority 1a: Nightlife Event Routes

### Outcome

When a traveler asks where to party, go out, hear live music, join a pub quiz,
or find the main General Luna nightlife move tonight, Ask Siargao should return
a timed route backed by event evidence. It should not answer with only a Google
Places bar shortlist.

### User Stories

- As a traveler in General Luna, I can ask "What are the best party places
  tonight?" and get a warm-up, main-party, late-option, and softer-option route.
- As a traveler planning around weather, I can see whether late-night rain
  changes the route or transport choice.
- As an operator, I can distinguish event schedule evidence from venue identity
  evidence and avoid overclaiming unverified crowd or door-policy details.

### Technical Specification

Add a `nightlifeEventPlan` intent and a `search_nightlife_events` tool.

The tool should:

- query fresh event facts first;
- refresh approved sources when cached facts are missing or stale;
- prioritize official venue pages, SiargaoVibes, official public venue social
  pages, and partner-submitted events;
- treat Reddit, travel blogs, and YouTube as low-confidence discovery or
  atmosphere signals;
- return event occurrences, source summaries, unverified boundaries, and venue
  IDs for Google Places enrichment.

Add `docs/agent-memory/NIGHTLIFE.md` and route party/nightlife prompts to it
from `docs/agent-memory/INDEX.md`. Runtime manifest and tests must include the
new memory file before deployment.

### Acceptance Criteria

- "What are the best party places in General Luna tonight?" requires event
  evidence before Places-only venue evidence.
- The final answer defaults to a route, not a directory.
- Google Places is used for map/open/venue fields, not event truth.
- The answer distinguishes checked event schedule, checked venue details,
  weather context, and unchecked crowd/door/cancellation signals.

### Test Plan

- Add intent tests for `tonight`, `party`, `DJ`, `live music`, `foam party`,
  and `pub quiz`.
- Add tool tests for event expiry and source-priority ordering.
- Add route tests that fail if the General Luna party prompt returns only
  Google Places bar cards.

## Priority 2: Contextual Follow-Up And Trip Memory

### Outcome

Ask Siargao should reliably understand follow-ups such as "nearby", "not too far", "open now", "something covered", "cheaper", "with kids", "not rocky", "best for swimming", "best for sunset", and "if it rains".

### User Stories

- As a traveler, I can ask "what should I do near Cloud 9 today?" and then "what if it rains?" without repeating Cloud 9.
- As a traveler, I can ask for sandy swimming beaches and then "what about sunset?" and the assistant switches from swimming logic to sunset logic.
- As a traveler, I can maintain constraints such as "no scooter" or "with kids" across a trip conversation.

### Technical Specification

Introduce a persistent or request-scoped `TripContext` layer before intent routing:

```ts
type TripContext = {
  tripId?: string;
  currentArea?: string;
  currentLocation?: {
    label: string;
    latitude?: number;
    longitude?: number;
    source: "user" | "gazetteer" | "browser_geolocation" | "google_places";
  };
  rideTimeLimitMinutes?: number;
  transportMode?: "walk" | "scooter" | "tricycle" | "van" | "unknown";
  travelerProfile?: {
    withKids?: boolean;
    budget?: "cheap" | "mid" | "premium";
    avoidsRain?: boolean;
    avoidsRockyBeaches?: boolean;
  };
  activeGoal?: "food" | "beach_swim" | "sunset" | "rain_plan" | "itinerary";
  temporaryModifiers: string[];
};
```

Start with a pure function that derives `TripContext` from the submitted message window. Later, persist it in trip/chat tables when the trip-pass flow is active.

Update the intent classifier so stable context and temporary modifiers are separate:

- Stable context persists: area, origin, ride-time limit, transport mode, traveler profile.
- Temporary modifiers override the latest goal: swimming, sunset, rainy day, cheaper, covered, open now.
- A new explicit goal clears incompatible previous modifiers.

Move duplicated regex logic from `chat-route.ts` and `recommendation-agent.ts` into a shared `src/server/chat/intent.ts` module with unit tests.

### Data Requirements

When persistence is added, use the trip and chat memory shape already described in `docs/TECH.md` and `docs/DATA_STRATEGY.md`:

- `trips`
- `chat_messages`
- `chat_requests`
- optional `trip_context_snapshots`

The first implementation can stay request-scoped to reduce migration risk.

### Acceptance Criteria

- Follow-ups inherit prior location and ride-time constraints.
- Latest user intent can switch from swimming to sunset without carrying stale swimming-only logic.
- Place follow-ups can resolve "there" and "nearby" from recent conversation.
- The assistant asks a clarifying question only when context is actually missing.

### Test Plan

- Add unit tests for context extraction and modifier precedence.
- Add route tests covering rainy follow-ups, open-now follow-ups, beach-use switching, and budget/kids constraints.
- Add regression tests for unrelated generic prompts to preserve Siargao scope guardrails.

## Priority 3: Trust Score And Source Labels

### Outcome

Every local recommendation should tell the traveler what was checked, what source was used, and what remains unverified.

### User Stories

- As a traveler, I can see whether an answer used live Google Places, cached Places, Open-Meteo, curated local data, or generic model reasoning.
- As a traveler, I can distinguish "open now checked" from "opening hours not verified".
- As a maintainer, I can test that answer source labels match actual provider usage.

### Technical Specification

Create a shared answer metadata contract:

```ts
type AnswerTrustLabel =
  | "live_checked"
  | "fresh_cache"
  | "curated_local_guide"
  | "weather_checked"
  | "not_verified"
  | "provider_unavailable";

type AnswerSourceSummary = {
  label: AnswerTrustLabel;
  sourceName: string;
  sourceProfileId?: string;
  fetchedAt?: string;
  confidence?: "high" | "medium" | "low";
  checked: string[];
  notChecked: string[];
};
```

Thread `AnswerSourceSummary[]` through:

- local beach rendering in `src/server/local/siargao-beaches.ts`;
- weather plan rendering in `src/app/api/chat/chat-route.ts`;
- recommendation rendering in `src/server/chat/recommendation-agent.ts`;
- future itinerary rendering.

Initially, render this as compact markdown lines because `ChatWorkspace` already recognizes `Checked:`, `Weather signal:`, and `Not checked:`. Later, render badges from structured JSON.

### Data Requirements

- Reuse `sourceProfileId`, `fetchedAt`, `confidence`, and evidence IDs from existing provider and fact graph types.
- Do not display source labels that are not backed by the route branch or provider result.

### Acceptance Criteria

- All grounded answers include checked and not-checked lines.
- Generic LLM fallback cannot claim live checks.
- Provider failures produce `provider_unavailable` caveats.
- Cached Places answers are labeled differently from live Places answers when that distinction is available.

### Test Plan

- Add route tests asserting source labels for beach, weather, Places, generic fallback, and provider-failure paths.
- Add renderer tests to ensure checked/not-checked lines are preserved for the frontend parser.

## Priority 4: AI Tool Runtime **COMPLETED**

### Outcome

Ask Siargao should have one primary chat agent that receives every user message,
decides which backend tools to call, and writes every final answer.

Deterministic weather, beach, recommendation, and local-plan renderers should be
converted into tools or validators. They should no longer produce the final
assistant message.

### User Stories

- As a traveler, I can ask "what should I do near Cloud 9 today?" and the AI can
  call weather, local guide, and Places tools before writing a natural answer.
- As a traveler, I can ask follow-ups without hearing repeated preset text.
- As a maintainer, I can add a backend capability as a tool without creating a
  new hardcoded response branch.

### Technical Specification

Create an agent runtime for `/api/chat`:

```ts
type AskSiargaoAgentTool =
  | "get_weather_forecast"
  | "search_places"
  | "get_place_details"
  | "search_local_guide"
  | "describe_database_schema"
  | "query_local_facts"
  | "describe_source_policy";

type AgentTurnResult = {
  message: string;
  requestId: string;
  model: string;
  toolCalls: AgentToolCallAudit[];
  sources: AnswerSourceSummary[];
  cards?: RecommendationCard[];
  actions?: ChatAction[];
};
```

The runtime should use the OpenAI Responses API with function tools or MCP tools.

The route flow becomes:

1. Validate request shape, rate limits, scope, and safety.
2. Build conversation input and persistent agent instructions.
3. Register backend tools.
4. Let the model call tools as needed.
5. Execute tool calls on the backend.
6. Continue the Responses tool loop until the model produces a final answer.
7. Validate source consistency and return the AI-written response.

Keep deterministic classifiers only as optional signals. They can help set tool
availability, default location hints, or safety constraints, but they cannot
choose final wording.

### Tool Requirements

Initial tools:

- `get_weather_forecast(location, date_range)` returns normalized Open-Meteo
  snapshots and concise condition signals.
- `search_places(query, center, radius_meters, constraints)` returns governed
  Google Places candidates from fresh cache or live lookup.
- `get_place_details(place_id)` returns allowed place fields only.
- `search_local_guide(query, filters)` returns curated Siargao entities and
  caveats.
- `describe_source_policy()` explains checked/not-checked labels available to
  the agent.

### Acceptance Criteria

- No successful `/api/chat` response is produced without an OpenAI model call.
- Weather, beach, local-guide, and recommendation prompts are AI-written.
- Existing provider checks still happen when the AI calls the matching tool.
- Tool call traces are logged for observability.
- Provider failure is returned to the model as tool output, not rendered directly
  as a preset final answer.

### Test Plan

- Add route tests proving common chat prompts invoke the model.
- Add tool-loop tests for weather, Places, local guide, and no-tool general
  Siargao prompts.
- Add regression tests that deterministic branches cannot return final prose.
- Add source-consistency tests for model answers that mention checked data.

## Priority 5: Persistent Agent Memory **COMPLETED**

### Outcome

Ask Siargao should give the AI durable product memory through Markdown files,
file search/vector stores, and schema/tool description tools.

Local Markdown files are not model memory by themselves. The app must explicitly
load or index them.

### User Stories

- As a maintainer, I can update agent behavior in Markdown without hiding product
  rules inside scattered code branches.
- As the AI agent, I can retrieve source policy, data dictionary, tool-use rules,
  and Siargao local assumptions when answering.
- As a product owner, I can review what the AI is expected to know.

### Technical Specification

Create agent memory files:

```text
docs/agent-memory/
  ASK_SIARGAO_AGENT_SKILLS.md
  ASK_SIARGAO_TOOL_USE_POLICY.md
  ASK_SIARGAO_DATA_DICTIONARY.md
  ASK_SIARGAO_SOURCE_POLICY.md
  ASK_SIARGAO_LOCAL_ASSUMPTIONS.md
```

Wire them into the agent with two paths:

1. Load small, stable policy files into Responses `instructions`.
2. Upload larger reference files into an OpenAI vector store and expose them
   through the `file_search` tool.

Add checksums or version IDs so deployments can tell which memory version the
agent used.

### Acceptance Criteria

- The agent receives product behavior instructions from Markdown, not only inline
  strings in code.
- The agent can retrieve larger Markdown references through file search or a
  backend memory tool.
- Tests fail if the required memory files are missing.
- The agent memory explains that every final answer must be AI-written and that
  tools are required for live/local facts.

### Test Plan

- Add unit tests for memory file loading and required-file validation.
- Add an integration test that verifies the chat adapter includes memory
  instructions.
- Add a tool test for retrieving source policy or data dictionary content.

## Priority 6: Safe Database And Local Knowledge Tools **COMPLETED**

### Outcome

The AI should understand the Ask Siargao data model and retrieve local facts on
demand without receiving unrestricted production database access.

### User Stories

- As a traveler, I can ask about beaches, transport, services, and local caveats,
  and the AI can retrieve curated data before answering.
- As the AI agent, I can inspect what structured data exists before choosing a
  query.
- As a maintainer, I can prevent unsafe SQL, restricted provider payload exposure,
  and source-policy violations.

### Technical Specification

Expose safe data tools:

```ts
type DatabaseSchemaToolResult = {
  publicViews: Array<{
    name: string;
    description: string;
    fields: Array<{ name: string; type: string; description: string }>;
  }>;
  queryRules: string[];
};

type LocalFactsQuery = {
  entityTypes: string[];
  area?: string;
  tags?: string[];
  text?: string;
  limit: number;
};
```

Preferred tool set:

- `describe_database_schema()` returns an AI-readable data dictionary for
  approved views and domain objects.
- `query_local_facts(query)` accepts structured filters rather than free SQL.
- `search_local_guide(query, filters)` searches curated data.
- `get_source_evidence(fact_ids)` returns source caveats allowed for display.

If a SQL-like tool is added later, it must be read-only, parsed before execution,
restricted to approved views, row-limited, timed out, and blocked from mutation.

### Acceptance Criteria

- The AI can discover available local fact structures.
- The AI can query curated/local data through allowlisted tools.
- No tool exposes raw restricted Google Places payloads or private user data.
- All returned facts include source or confidence metadata.

### Test Plan

- Add tests for schema-description output.
- Add tests for local fact queries by area, tag, and entity type.
- Add negative tests for unsafe SQL or disallowed table access if SQL is added.
- Add source-policy tests for provider-derived fields.

## Priority 7: Map-First Recommendation Cards **COMPLETED**

### Outcome

Local recommendations should become actionable UI cards with map link, distance,
open status, fit rationale, source label, and follow-up actions.

The AI still writes the message. Cards are structured artifacts produced from
tool results and returned alongside the AI answer.

### User Stories

- As a traveler, I can scan recommendations quickly instead of reading a dense
  paragraph.
- As a traveler, I can open the map for a place from the answer.
- As a traveler, I can ask for alternatives, save an option, or request an
  itinerary using a returned place.

### Technical Specification

Add a structured response mode to `/api/chat` while keeping markdown
compatibility:

```ts
type ChatResponseBody = {
  message: string;
  requestId: string;
  cards?: RecommendationCard[];
  actions?: ChatAction[];
  sources?: AnswerSourceSummary[];
};

type RecommendationCard = {
  kind: "place" | "beach" | "activity" | "route";
  title: string;
  subtitle?: string;
  mapsUrl?: string;
  distanceLabel?: string;
  openStatusLabel?: string;
  fitReasons: string[];
  caveats: string[];
  sourceLabel: string;
};

type ChatAction = {
  id: string;
  label: string;
  prompt: string;
};
```

Update `src/features/chat/ChatWorkspace.tsx` to render cards when present and
fall back to markdown-only messages when absent. Keep links accessible and
preserve source caveats in the card footer.

### Acceptance Criteria

- Places and beach answers can render as cards.
- Map links open in a new tab and use returned Google Maps URLs when available.
- Cards include source labels and caveats.
- The markdown fallback still works for clients that ignore structured fields.

### Test Plan

- Add React tests or e2e coverage for card rendering, map links, and fallback
  markdown.
- Add route tests confirming `cards` shape for Places and beach answers.
- Add Playwright coverage for mobile card layout once the UI exists.

## Priority 8: Local Itinerary Builder **COMPLETED**

### Outcome

Ask Siargao should produce 2-4 hour practical plans, not only lists of places.

The itinerary should be AI-written after the agent retrieves local guide data,
weather data, and live place data as needed.

### User Stories

- As a traveler, I can ask for a rainy Cloud 9 afternoon and receive a short
  sequence with fallback options.
- As a traveler, I can ask for sunset plus dinner and get a route-aware plan.
- As a traveler, I can ask for a non-surfer half-day and avoid stops that do not
  fit my ride-time limit or weather.

### Technical Specification

Add itinerary-specific tools and structured output:

```ts
type ItineraryPlan = {
  title: string;
  durationLabel: string;
  stops: ItineraryStop[];
  fallbackStops: ItineraryStop[];
  skip: string[];
  sources: AnswerSourceSummary[];
};

type ItineraryStop = {
  title: string;
  kind: "place" | "beach" | "activity" | "meal" | "transfer";
  sequence: number;
  area?: string;
  travelTimeFromPreviousMinutes?: number;
  mapsUrl?: string;
  rationale: string;
  caveats: string[];
};
```

The agent should combine:

- trip context for origin and constraints;
- local guide tools for stable suitability;
- Google Places tools for live place choices and open-now checks;
- weather tools for rain, wind, and outdoor exposure.

### Acceptance Criteria

- Itinerary prompts do not return generic brainstorms.
- Plans include a sequence, travel time estimates, fallback, what to skip, and
  source caveats.
- Rainy-day plans use weather tools automatically.
- Dinner or cafe stops use Places when live open status matters.

### Test Plan

- Add itinerary tool tests for each initial theme.
- Add route tests for rainy Cloud 9 afternoon, sunset plus dinner, sandy beach
  half-day, and food crawl.
- Add tests for fallback substitution under high rain probability.

## Priority 9: Weather, Tide, And Surf Fusion **COMPLETED**

### Outcome

Ask Siargao should convert weather, tide, and surf signals into a practical
condition judgment instead of reporting raw weather only.

Weather details should stay essential. The AI should lead with what the traveler
should do, then cite only the weather facts that matter.

### User Stories

- As a traveler, I can ask whether a beach is good for swimming now and get a
  practical recommendation.
- As a traveler, I can ask "what should I avoid today?" and get weather-aware
  local caveats.
- As a traveler, I can distinguish weather-checked facts from unverified tide,
  surf, road, and swimming-safety facts.

### Technical Specification

Expose condition signals through tools:

```ts
type ConditionSignal = {
  kind: "weather" | "tide" | "surf" | "road" | "manual_caveat";
  status: "checked" | "not_checked" | "unavailable";
  level: "low" | "medium" | "high";
  summary: string;
  source?: AnswerSourceSummary;
};

type ConditionJudgment = {
  activity: "swimming" | "surfing" | "scooter" | "rain_plan" | "sunset" | "boat_trip";
  recommendation: "good" | "flexible" | "avoid" | "needs_local_confirmation";
  reasons: string[];
  alternatives: string[];
  signals: ConditionSignal[];
};
```

Initial implementation should use existing Open-Meteo data and curated local
caveats. Tide and surf should remain explicitly `not_checked` until approved
providers are integrated.

### Acceptance Criteria

- Weather-sensitive activity answers include a recommendation, reasons,
  alternatives, and caveats.
- Weather prose is concise and decision-oriented.
- Tide and surf are not implied as checked before provider integration.
- Beach answers can merge curated beach suitability with weather signals.

### Test Plan

- Add unit tests for weather thresholds and condition judgments.
- Add route tests for swimming, rainy-day, scooter, and sunset prompts.
- Add regression tests that tide/surf are labeled not checked until providers
  exist.

## Priority 10: Consent-Based Near-Me Geolocation **COMPLETED**

Status: Complete as of 2026-06-27.

### Outcome

Travelers should be able to share their current location and receive nearby
guidance without typing Cloud 9, General Luna, Dapa, or another area.

### User Stories

- As a traveler, I can tap a location control and ask "what is open near me?"
- As a traveler, I can continue without sharing location and still type an area
  manually.
- As a privacy-conscious user, I can see that location sharing is optional and
  scoped to the request or trip.

### Technical Specification

Add client-side geolocation support in `ChatWorkspace`:

```ts
type ChatClientContext = {
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    capturedAt: string;
    consentScope: "single_request" | "trip_session";
  };
};
```

Extend `/api/chat` request schema:

```ts
messages: ChatMessage[];
clientContext?: ChatClientContext;
```

On the server:

- validate coordinates are plausibly in or near Siargao before exposing them to
  tools;
- treat browser geolocation as user-provided context;
- use it as the Places search center for nearby requests;
- do not persist it unless trip-session consent is explicit;
- include the location source in trust/source metadata.

### Acceptance Criteria

- "Near me" works when browser location is supplied.
- The app still works without geolocation.
- Out-of-area coordinates are rejected or ignored with a clear explanation.
- Location source is visible in answer metadata or caveats.

### Test Plan

- Add schema tests for valid, missing, and invalid client context.
- Add route tests for near-me Places search center selection.
- Add e2e coverage for the geolocation permission path using mocked browser
  permissions.

### Completed Behavior

- `ChatWorkspace` offers an optional single-request location control and sends
  `clientContext.geolocation` only after an explicit click.
- `/api/chat` validates geolocation shape, capture time, consent scope, accuracy,
  and Siargao-area plausibility before passing usable coordinates to the agent.
- Near-me Google Places searches use consented browser geolocation as the search
  center, bypass persistent chat-search cache storage for exact single-request
  coordinates, and keep final prose AI-written.
- Browser-location source metadata is visible through Places source fields and
  card/tool caveats without displaying raw coordinates.
- E2E coverage exercises granted, denied, skipped, and single-request-consumed
  location flows with mocked browser geolocation.

## Priority 11: Save And Share Trip Plans **COMPLETED**

Status: Complete as of 2026-06-28.

### Outcome

Travelers should be able to keep useful recommendations and share compact trip
plans.

### User Stories

- As a traveler, I can save a restaurant, beach, or itinerary from chat.
- As a traveler, I can share a plan with a friend without exposing the full chat.
- As a maintainer, I can preserve source caveats and freshness labels when a plan
  is shared.

### Technical Specification

Add saved plan models:

```ts
type SavedTripItem = {
  id: string;
  tripId: string;
  kind: "place" | "beach" | "itinerary" | "note";
  title: string;
  payload: RecommendationCard | ItineraryPlan | Record<string, unknown>;
  sources: AnswerSourceSummary[];
  createdAt: string;
};

type SharedTripPlan = {
  id: string;
  tripId: string;
  publicToken: string;
  title: string;
  itemIds: string[];
  expiresAt?: string;
};
```

Start with local browser storage for unauthenticated chat sessions if there is no
trip persistence yet. When trip/pass persistence is active, move saved items to
Postgres and expose a share route that renders only selected items and allowed
source metadata.

### Acceptance Criteria

- Users can save cards or itineraries from the chat UI.
- Shared plans show selected items, maps links, caveats, and source freshness.
- Shared plans do not expose unrelated chat history.
- Expired or deleted shared tokens stop rendering.

### Test Plan

- Add UI tests for saving and removing items.
- Add API tests for share-token creation and access control once server
  persistence exists.
- Add source-policy tests to ensure restricted provider content is not exposed.

### Completed Behavior

- Travelers can save recommendation cards and itinerary plans from chat, remove them, and keep
  the saved tray locally across reloads.
- Share creation syncs only selected saved items to the saved-trip APIs, resolves the stored
  saved-trip row by client trip key, and creates an unguessable public share token.
- Public shared plans render selected cards and itineraries without full chat history, raw
  provider payloads, Google review text, exact browser geolocation, or unrelated client context.
- Shared recommendation cards preserve captured map links, source labels, and open-status labels
  when present, while adding a browser-saved caveat that the captured status was not reverified
  before sharing.
- Shared itinerary plans render primary and fallback stops with area labels, rationale, per-stop
  caveats, and Google Maps links when available.
- Shared plans preserve allowed source freshness, checked/not-checked labels, expiry/deletion
  behavior, and generic unavailable-token rendering.

## Delivery Order

| Order | Item | Dependency | Reason |
| ---: | --- | --- | --- |
| 1 | AI tool runtime | Completed Priorities 1-3 | Corrects the product direction by making every response AI-written. |
| 2 | Persistent agent memory | AI tool runtime | Gives the model durable behavior, source, and schema knowledge. |
| 3 | Safe database and local knowledge tools | Agent memory and existing schema | Lets the AI retrieve local facts without unsafe DB access. |
| 4 | Map-first recommendation cards | Tool runtime and source metadata | Converts tool results into practical travel UI while preserving AI prose. |
| 5 | Local itinerary builder | Tools, context, cards | Combines live places, context, weather, and local data into plans. |
| 6 | Weather, tide, and surf fusion | Weather tool and local caveats | Improves condition judgments without verbose raw weather reporting. |
| 7 | Consent-based near-me geolocation | Tool runtime and Places tools | Makes nearby recommendations faster and more accurate. |
| 8 | Save and share trip plans | Cards and itineraries | Adds retention and collaboration after core answer quality exists. |

## Product Metrics

- Share of `/api/chat` responses that include an OpenAI model call.
- Share of local/live prompts where the model called at least one relevant tool.
- Share of answers with source labels backed by actual tool outputs.
- Provider failure rate and model-handled fallback rate.
- Average tool-loop latency.
- Repeat follow-up success rate without restating area.
- User reports of repeated or templated wording.
- Card click-through rate for map links.
- Saved itinerary or saved place rate.
- User-visible caveat coverage for weather, open-now, tide, surf, roads,
  bookings, and seating.

## Non-Goals

- Competing with ChatGPT or Claude on broad reasoning.
- Replacing AI-written answers with deterministic local templates.
- Letting the model execute unrestricted SQL against production data.
- Bulk-indexing every Siargao business before user demand exists.
- Building a permanent raw Google Places or review corpus.
- Claiming tide, surf, road, booking, or seating verification before approved
  providers exist.
- Turning the app into a generic trip planner for all destinations.
