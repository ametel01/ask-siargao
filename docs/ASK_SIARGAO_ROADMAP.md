# Ask Siargao Product Roadmap

## Purpose

This roadmap turns the positioning in [ASK_SIARGAO_POSITIONING.md](ASK_SIARGAO_POSITIONING.md) into an implementation plan.

Ask Siargao should not compete as a general chatbot. It should become the Siargao trip copilot that helps a traveler decide what to do next based on local context, live place data, weather, distance, and source caveats.

## Product Promise

Ask Siargao gives practical, current trip decisions for Siargao: what to do, where to go, what is nearby, what is open, and what to avoid based on weather, distance, and local context.

## Roadmap Principles

- Prefer deterministic routing for live facts instead of relying on the LLM to decide when to search.
- Check existing internal facts before calling live providers.
- Treat Google Places and Open-Meteo as governed providers with field masks, freshness windows, retention rules, and source caveats.
- Keep local Siargao curation as structured data, not hidden prompt text.
- Return answers that a traveler can act on: place, distance, open signal, map link, reason, caveat, and fallback.
- Make follow-ups inherit stable trip context while allowing the latest modifier to change the answer goal.

## Current Implementation Baseline

The repo already has useful foundations for this roadmap:

- `src/app/api/chat/chat-route.ts` classifies food, beach, weather, nearby, and activity-plan intents.
- `src/server/chat/recommendation-agent.ts` routes food and place-like questions through a planner, Google Places lookup, ranking, and rendered answer.
- `src/server/providers/google-places-chat.ts` performs Places Text Search with a controlled field mask.
- `src/server/providers/google-places-chat-cache.ts` checks fresh cached Google Places rows before calling the live provider and persists live results.
- `src/server/local/siargao-beaches.ts` contains deterministic curated beach guidance with ride-time, surface, use-case, tide-note, and caveat fields.
- `src/server/providers/open-meteo.ts` and `src/server/public-pages/weather-snapshot.ts` provide weather forecast ingestion and chat-ready snapshots.
- `src/features/chat/ChatWorkspace.tsx` renders assistant markdown, links, source lines, and a chat composer.
- `src/server/db/schema.ts` already includes source-governance, fact, evidence, Google Places, weather, public content, and payment-related tables.

The roadmap should deepen these systems rather than replace them.

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

## Priority 4: Map-First Recommendation Cards

### Outcome

Local recommendations should become actionable UI cards with map link, distance, open status, fit rationale, source label, and follow-up actions.

### User Stories

- As a traveler, I can scan recommendations quickly instead of reading a dense paragraph.
- As a traveler, I can open the map for a place from the answer.
- As a traveler, I can ask for alternatives, save an option, or request an itinerary using a returned place.

### Technical Specification

Add a structured response mode to `/api/chat` while keeping markdown compatibility:

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

Update `src/features/chat/ChatWorkspace.tsx` to render cards when present and fall back to markdown-only messages when absent. Keep links accessible and preserve source caveats in the card footer.

Card-producing backends:

- Places recommendations: derive from `LocalRecommendation`.
- Beach recommendations: derive from `SiargaoBeach`.
- Itineraries: derive from itinerary stops after Priority 6.

### UI Requirements

- Cards should be compact and scannable inside the existing chat stream.
- Use icon buttons for map/open/save actions where practical.
- Do not hide source caveats behind an unexplained decorative element.
- Preserve the existing chat composer and retry behavior.

### Acceptance Criteria

- Places and beach answers can render as cards.
- Map links open in a new tab and use returned Google Maps URLs when available.
- Cards include source labels and caveats.
- The markdown fallback still works for clients that ignore structured fields.

### Test Plan

- Add React tests or e2e coverage for card rendering, map links, and fallback markdown.
- Add route tests confirming `cards` shape for Places and beach answers.
- Add Playwright coverage for mobile card layout once the UI exists.

## Priority 5: Siargao-Specific Data Packs

### Outcome

Ask Siargao should answer common local questions from deterministic curated datasets before falling back to generic LLM reasoning.

### User Stories

- As a traveler, I can ask for sandy beaches, rainy-day activities, sunset spots, ATMs, clinics, laundry, SIM help, scooter rentals, and airport transfer basics.
- As a maintainer, I can update local guidance without editing prompt text.
- As a product owner, I can see which local datasets exist and which caveats they carry.

### Technical Specification

Generalize `src/server/local/siargao-beaches.ts` into a local guide module:

```text
src/server/local/
  siargao-guide.ts
  datasets/
    beaches.ts
    rainy-day-activities.ts
    sunset-spots.ts
    essential-services.ts
    transport.ts
    safety-caveats.ts
```

Use a common entity shape:

```ts
type LocalGuideEntity = {
  id: string;
  name: string;
  category: string;
  area: string;
  tags: string[];
  distanceFromGeneralLunaMinutes?: { min: number; max: number };
  location?: { latitude: number; longitude: number };
  fit: Record<string, string>;
  caveats: string[];
  confidence: "high" | "medium" | "low";
  sourceNotes: string;
  reviewBy?: string;
};
```

Build deterministic retrieval helpers:

- `findLocalGuideEntities(query)`
- `rankLocalGuideEntities(entities, filters)`
- `renderLocalGuideAnswer(result)`

The intent router should consult local datasets for stable local knowledge such as geography, surfaces, ride-time estimates, rain exposure, and safety caveats. It should use Google Places for live identity, hours, map links, ratings, and open-now status.

### Data Requirements

Start with TypeScript data modules for reviewability. Move to DB tables only when editing workflows or public APIs require it.

Initial datasets:

- beaches
- surf spots
- rainy-day activities
- sunset spots
- cafes with likely covered seating
- ATMs
- pharmacies and clinics
- laundry
- SIM and phone support
- transport and scooter rentals
- ferry and airport transfer basics
- common tourist traps and safety caveats

### Acceptance Criteria

- Beach logic no longer lives as a one-off module.
- At least three new local guide categories can answer deterministic prompts.
- Local guide answers include confidence, source notes, and not-checked caveats.
- Live place facts are still delegated to Google Places when current status matters.

### Test Plan

- Add unit tests for dataset validation, filtering, ranking, and rendering.
- Add route tests for non-beach local guide questions.
- Add tests that open-now questions still route to Places instead of static data.

## Priority 6: Local Itinerary Builder

### Outcome

Ask Siargao should produce 2-4 hour practical plans, not only lists of places.

### User Stories

- As a traveler, I can ask for a rainy Cloud 9 afternoon and receive a short sequence with fallback options.
- As a traveler, I can ask for sunset plus dinner and get a route-aware plan.
- As a traveler, I can ask for a non-surfer half-day and avoid stops that do not fit my ride-time limit or weather.

### Technical Specification

Add an itinerary intent and planner:

```ts
type ItineraryIntent = {
  durationHours: 2 | 3 | 4 | "half_day";
  origin?: TripContext["currentLocation"];
  theme:
    | "rainy_day"
    | "sunset_dinner"
    | "sandy_beach"
    | "food_crawl"
    | "non_surfer"
    | "scooter_day";
  constraints: string[];
};

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

Build itinerary candidates from:

- `TripContext` for origin and constraints;
- local guide datasets for stable suitability;
- Google Places for live place choices and open-now checks;
- weather snapshot for rain, wind, and outdoor exposure.

Keep sequencing deterministic at first:

1. Select theme.
2. Select origin and radius.
3. Choose 2-4 stops that fit travel-time constraints.
4. Replace outdoor stops with covered fallbacks when weather risk is high.
5. Render sequence, travel time, fallback, skip list, and source caveats.

### Acceptance Criteria

- Itinerary prompts do not return generic brainstorms.
- Plans include a sequence, travel time estimates, fallback, what to skip, and source caveats.
- Rainy-day plans use weather context automatically.
- Dinner or cafe stops use Places when live open status matters.

### Test Plan

- Add itinerary planner unit tests for each initial theme.
- Add route tests for rainy Cloud 9 afternoon, sunset plus dinner, sandy beach half-day, and food crawl.
- Add tests for fallback substitution under high rain probability.

## Priority 7: Weather, Tide, And Surf Fusion

### Outcome

Ask Siargao should convert weather, tide, and surf signals into a practical condition judgment instead of reporting raw weather only.

### User Stories

- As a traveler, I can ask whether a beach is good for swimming now and get a practical recommendation.
- As a traveler, I can ask "what should I avoid today?" and get weather-aware local caveats.
- As a traveler, I can distinguish weather-checked facts from unverified tide, surf, road, and swimming-safety facts.

### Technical Specification

Extend the weather answer layer into a condition engine:

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

Initial implementation should use existing Open-Meteo data and curated local caveats. Tide and surf should remain explicitly `not_checked` until approved providers are integrated.

Later provider options:

- tide API with Siargao-relevant station mapping;
- surf forecast provider with explicit terms review;
- official advisories or municipal/provincial sources for closures and safety notices.

### Acceptance Criteria

- Weather-sensitive activity answers include a recommendation, reasons, alternatives, and caveats.
- Tide and surf are not implied as checked before provider integration.
- The answer can say "avoid" when rain or wind thresholds make the plan weak.
- Beach answers can merge curated beach suitability with weather signals.

### Test Plan

- Add unit tests for weather thresholds and condition judgments.
- Add route tests for swimming, rainy-day, scooter, and sunset prompts.
- Add regression tests that tide/surf are labeled not checked until providers exist.

## Priority 8: Consent-Based Near-Me Geolocation

### Outcome

Travelers should be able to share their current location and receive nearby guidance without typing Cloud 9, General Luna, Dapa, or another area.

### User Stories

- As a traveler, I can tap a location control and ask "what is open near me?"
- As a traveler, I can continue without sharing location and still type an area manually.
- As a privacy-conscious user, I can see that location sharing is optional and scoped to the request or trip.

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

- validate coordinates are plausibly in or near Siargao before using them;
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
- Add e2e coverage for the geolocation permission path using mocked browser permissions.

## Priority 9: Save And Share Trip Plans

### Outcome

Travelers should be able to keep useful recommendations and share compact trip plans.

### User Stories

- As a traveler, I can save a restaurant, beach, or itinerary from chat.
- As a traveler, I can share a plan with a friend without exposing the full chat.
- As a maintainer, I can preserve source caveats and freshness labels when a plan is shared.

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

Start with local browser storage for unauthenticated chat sessions if there is no trip persistence yet. When trip/pass persistence is active, move saved items to Postgres and expose a share route that renders only selected items and allowed source metadata.

### Data Requirements

Potential tables:

- `saved_trip_items`
- `shared_trip_plans`

Shared pages must not expose private chat messages, unrestricted provider payloads, or paid-only context unless explicitly selected and allowed.

### Acceptance Criteria

- Users can save cards or itineraries from the chat UI.
- Shared plans show selected items, maps links, caveats, and source freshness.
- Shared plans do not expose unrelated chat history.
- Expired or deleted shared tokens stop rendering.

### Test Plan

- Add UI tests for saving and removing items.
- Add API tests for share-token creation and access control once server persistence exists.
- Add source-policy tests to ensure restricted provider content is not exposed.

## Delivery Order

| Order | Item | Dependency | Reason |
| ---: | --- | --- | --- |
| 1 | Live open-now local recommendations | Existing Places cache and recommendation agent | Highest user value and strongest differentiation from generic chat. |
| 2 | Contextual follow-up and trip memory | Item 1 | Makes live recommendations useful across conversation turns. |
| 3 | Trust score and source labels | Items 1-2 | Turns provider usage into visible trust. |
| 4 | Map-first recommendation cards | Items 1 and 3 | Converts grounded results into a practical travel UI. |
| 5 | Siargao-specific data packs | Existing beach guide | Expands deterministic local knowledge beyond beaches. |
| 6 | Local itinerary builder | Items 1, 2, 5 | Combines live places, context, and local data into plans. |
| 7 | Weather, tide, and surf fusion | Existing weather snapshots, Item 5 | Improves condition judgments and avoids unsafe generic advice. |
| 8 | Consent-based near-me geolocation | Items 1-2 | Makes nearby recommendations faster and more accurate. |
| 9 | Save and share trip plans | Items 4 and 6 | Adds retention and collaboration after the core answer quality exists. |

## Product Metrics

- Share of local-place prompts routed through Places or fresh cache instead of generic LLM fallback.
- Share of grounded answers with checked/not-checked labels.
- Provider failure rate and fallback rate.
- Average recommendation answer latency.
- Repeat follow-up success rate without restating area.
- Card click-through rate for map links.
- Saved itinerary or saved place rate.
- User-visible caveat coverage for weather, open-now, tide, surf, roads, bookings, and seating.

## Non-Goals

- Competing with ChatGPT or Claude on broad reasoning.
- Bulk-indexing every Siargao business before user demand exists.
- Building a permanent raw Google Places or review corpus.
- Claiming tide, surf, road, booking, or seating verification before approved providers exist.
- Turning the app into a generic trip planner for all destinations.
