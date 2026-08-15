# Technical Spec: Ask Siargao

## Purpose

Build a production-grade chat application for Siargao tourists. The app should accept natural-language trip plans and questions, maintain trip context, retrieve fresh local facts when needed, normalize useful provider results into Postgres, and answer with confidence and freshness labels.

The core technical shift is from a precomputed trip-risk audit to a lazy, chat-first fact system.

## Product Architecture

```text
chat UI
  -> trip context extractor
  -> intent and retrieval planner
  -> fact store
  -> provider adapters when needed
  -> fact normalizer
  -> bounded answer context
  -> LLM answer generation
  -> usage meters and cost logging
```

The LLM should not have direct unrestricted provider access. It may propose retrieval needs, but
deterministic code decides whether existing facts are fresh enough and whether a provider call is
allowed by source policy and cost controls. Provider selection is not a user-facing product mode.

## Stack

- Framework: Next.js App Router.
- Language: TypeScript.
- Styling: Tailwind CSS v4 with shadcn source components and Ask Siargao CSS variables.
- Database: Postgres.
- ORM: Drizzle, matching the current codebase direction.
- Payments: Stripe Checkout.
- LLM: OpenAI Responses API or a small adapter around the current OpenAI SDK.
- Provider data: Google Places, production MET Norway weather, production NOAA/PacIOOS modeled tides, local-only Open-Meteo/Tide-Forecast adapters, approved event sources, and later approved partner or official sources.
- Background jobs: start with explicit scripts and request-time jobs; add Redis, Inngest, Trigger.dev, or equivalent when async workload requires it.

## Frontend Surfaces

Primary surfaces:

- Chat-first landing page.
- Trip pass paywall.
- Paid chat workspace.
- Trip context panel.
- Weather widget.
- Recommendation cards with map, source freshness, and confidence.
- Remaining travel-answer and Trip Pass expiry state.

Secondary surfaces:

- Admin/provider diagnostics.
- Public source-backed pages where facts are allowed for publication.
- Agent-readable Markdown and JSON surfaces later, after the chat product has useful facts.

The first screen should let users paste a plan or ask a question. It should not start with a long form.

## Chat Request Flow

```text
1. Persist user message.
2. Extract or update trip context.
3. Classify intent.
4. Determine required fact types and freshness windows. Time-bound nightlife prompts should
   produce event requirements before generic place requirements.
5. Query internal facts.
6. If facts are sufficient, build answer context from DB.
7. If facts are stale or missing, check source policy and provider cost controls.
8. Call provider adapters when allowed.
9. Normalize observations into entities, facts, and source observations.
10. Build bounded answer context.
11. Generate final answer.
12. Persist assistant message, usage, provider cost, and fact IDs used.
```

The current Priority 2 slice implements the trip-context and intent parts as a request-scoped
boundary before persistence exists. `/api/chat` receives the bounded client message window and
`src/server/chat/intent.ts` derives a pure `TripContext` from that window. The context carries
stable location, area, ride-time, transport mode, traveler profile, and durable constraints
separately from latest-turn modifiers such as open-now, covered, cheaper, rainy-day, swimming,
sunset, and itinerary changes.

`src/app/api/chat/chat-route.ts`, `src/server/chat/place-intent.ts`, and the Ask Siargao chat tool
loop use that shared context for weather planning, grounded beach guidance, local recommendation
searches, and clarification when a follow-up like "there" has no referent. This keeps provider use
deterministic and request-scoped while leaving persistent trip and chat tables for the later storage
milestone.

## Core Modules

Suggested source layout:

```text
src/
  app/
    api/
      chat/
      payments/
  features/
    chat/
    landing/
    trip/
    weather/
  server/
    chat/
    trips/
    facts/
    providers/
    usage/
    payments/
    llm/
    db/
```

Key modules:

- `TripContextStore`: stores dates, accommodation, area, traveler profile, constraints, and pass expiry.
- `ChatRequestPlanner`: maps a message to intents, fact requirements, and freshness needs.
- `FactStore`: hides Postgres lookup, freshness checks, provider calls, normalization, and answer-context construction behind a small interface.
- `ProviderRegistry`: enforces source profiles, allowed use, field masks, raw-storage rules, and rate limits.
- `UsageMeter`: tracks the current product's travel answers. Legacy specialized meter rows remain
  readable for version 1 grant reconciliation but are not enforced by the current chat path.
- `AnswerGenerator`: calls the LLM with bounded facts and returns structured answer content.
- `NightlifeEventAdapter`: checks approved event sources, normalizes recurring and dated nightlife
  occurrences, and returns event facts for route-style answers.

## Data Model

Minimum chat and trip tables:

```text
trips
chat_messages
chat_requests
trip_usage_meters
payments
```

Minimum fact tables:

```text
entities
entity_external_ids
source_profiles
source_records
source_observations
facts
evidence
fact_confidence_scores
provider_health_checks
```

The existing source governance and fact-graph tables should remain useful, but the request path should become demand-driven rather than bulk-ingestion-first.

## Answer Context Interface

Callers should use one deep module interface rather than manually orchestrating DB lookup and provider calls at every route.

```ts
type AnswerContextRequest = {
  tripId: string;
  userMessageId: string;
  intent: string;
  requiredFactTypes: string[];
  freshnessPolicy: Record<string, string>;
};

type AnswerContext = {
  facts: NormalizedFact[];
  evidence: EvidenceSummary[];
  gaps: FactGap[];
  liveRefreshesUsed: number;
  estimatedCostCents: number;
};
```

The implementation owns:

- entity resolution
- freshness checks
- provider selection
- rate-limit and usage-meter checks
- source-policy enforcement
- normalization
- source attribution
- bounded answer context creation

## Provider Policy

Provider adapters must enforce policy before storage and display.

Google Places rules for this product:

- Store Place IDs as durable external identifiers.
- Store normalized internal facts with confidence and observed timestamps.
- Keep raw payloads short-lived or trip-scoped unless terms allow broader retention.
- Do not build a reusable raw review corpus.
- Display provider attribution when required.
- Use field masks to control cost.

Weather and tide provider rules:

- Weather facts can be refreshed frequently.
- Today's forecast should expire quickly.
- Weather answers should include observation or forecast time.
- Production weather uses MET Norway Locationforecast with an identifying User-Agent, caching, and
  CC BY 4.0 attribution.
- Production tide timing uses the NOAA/PacIOOS public-domain Pacific barotropic model. Treat its
  nearest 2-degree grid point as a coarse planning proxy, not a local station or safety signal.
- Open-Meteo and Tide-Forecast remain local/preview-only unless their commercial boundaries change.

Manual or user-submitted evidence:

- Can support private trip answers.
- Should not become public unless the user or provider grants publication rights.

Nightlife and event source rules:

- Query official venue websites first for recurring schedules, closed days, and official event
  names.
- Query local event directories such as SiargaoVibes for dated occurrences and upcoming event
  pages.
- Use official public Instagram or Facebook venue pages only through an allowed access method and
  store extracted facts, not raw social-media bodies.
- Treat Reddit and broad travel guides as low-confidence community or discovery signals.
- Use Google Places only for venue identity, map links, ratings, business status, and opening-hour
  signals. Do not rank nightlife from Google Places relevance alone.
- Event facts expire after the event. Recurring patterns must carry a source URL and review date.

Nightlife answer flow:

```text
nightlife prompt
  -> load NIGHTLIFE.md for stable local context
  -> search_nightlife_events for current event occurrences
  -> search_places or get_place_details for selected venue enrichment
  -> get_weather_forecast for tonight route movement when relevant
  -> LLM writes route-style answer with event, venue, weather, and unchecked boundaries
```

## Usage Meters

The version 2 pass has one customer-facing entitlement meter: travel answers.

```text
trip_usage_meters
  trip_id
  meter_type
  used
  limit
  reset_at
  updated_at
```

The current meter is `chat_message`: 10 successful free answers over seven days or 150 successful
paid answers over the 14-day pass. Weather, Places, surf, event, public-evidence, and route tools run
automatically when source policy and cost circuits allow. They do not consume separate traveler
allowances.

The ledger still accepts version 1 `live_refresh`, `heavy_recommendation`, `weather_refresh`, and
`route_lookup` rows so existing orders and webhook retries remain reconcilable.

## Payment Flow

1. User gets 10 free travel answers over seven days.
2. The free answer allowance is used.
3. App shows the `$9.99` USD Siargao Trip Pass with 150 answers for 14 days.
4. User pays through Stripe Checkout.
5. Verified Stripe webhook activates the trip pass.
6. One 150-answer meter is initialized for the pass duration.
7. Paid chat automatically uses appropriate evidence tools while answers remain.

Stripe webhook verification remains the source of truth for pass activation.

## LLM Responsibilities

LLM can:

- parse trip context from natural language
- classify user intent
- summarize facts into a helpful answer
- explain tradeoffs and caveats
- generate follow-up questions when facts are missing

LLM must not:

- invent local facts
- bypass source policy
- decide payment state
- decide provider retention policy
- call external APIs directly without deterministic gating
- expose restricted raw provider content
- treat stable memory, Google Places relevance, or community chatter as proof of tonight's event
  schedule

## Testing Decisions

Test the request lifecycle at the highest practical seam:

- free chat creates trip context
- missing fresh facts trigger allowed provider calls
- fresh facts avoid provider calls
- provider results normalize into facts
- successful answers settle exactly one answer meter unit
- provider policy and cost circuits bound expensive calls without exposing a deep-search switch
- paid pass activates only from verified Stripe webhooks
- source policies prevent restricted raw data from public surfaces
- answer context includes freshness and confidence

Provider adapters should have focused unit tests for field masks, allowed-use checks, normalization, TTLs, and error handling.

## Observability

Track:

- chat starts
- free-to-paid conversion
- paid questions per trip
- travel answers per trip
- evidence-tool and provider calls per trip
- cost per provider call
- cost per paid trip
- cached-answer rate
- provider error rate
- accommodation resolution success
- fact freshness misses
- user usefulness feedback

The economic dashboard should answer: at the current price, how many average paid users are profitable after Stripe, LLM, and provider costs?
