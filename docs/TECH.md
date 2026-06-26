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

The LLM should not have direct unrestricted provider access. It may propose retrieval needs, but deterministic code decides whether existing facts are fresh enough, whether a provider call is allowed, and whether the user's pass has live refresh budget.

## Stack

- Framework: Next.js App Router.
- Language: TypeScript.
- Styling: Tailwind CSS v4 with shadcn source components and Ask Siargao CSS variables.
- Database: Postgres.
- ORM: Drizzle, matching the current codebase direction.
- Payments: Stripe Checkout.
- LLM: OpenAI Responses API or a small adapter around the current OpenAI SDK.
- Provider data: Google Places, Open-Meteo, and later approved partner or official sources.
- Background jobs: start with explicit scripts and request-time jobs; add Redis, Inngest, Trigger.dev, or equivalent when async workload requires it.

## Frontend Surfaces

Primary surfaces:

- Chat-first landing page.
- Trip pass paywall.
- Paid chat workspace.
- Trip context panel.
- Weather widget.
- Recommendation cards with map, source freshness, and confidence.
- Usage state for live refreshes when near limit.

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
4. Determine required fact types and freshness windows.
5. Query internal facts.
6. If facts are sufficient, build answer context from DB.
7. If facts are stale or missing, check usage meters and source policy.
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

`src/app/api/chat/chat-route.ts`, `src/server/chat/place-intent.ts`, and
`src/server/chat/recommendation-agent.ts` use that shared context for weather planning, grounded
beach guidance, local recommendation searches, and clarification when a follow-up like "there" has
no referent. This keeps provider use deterministic and request-scoped while leaving persistent trip
and chat tables for the later storage milestone.

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
- `UsageMeter`: tracks chat messages, live refreshes, heavy recommendation searches, weather refreshes, and route lookups.
- `AnswerGenerator`: calls the LLM with bounded facts and returns structured answer content.

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

Open-Meteo rules:

- Weather facts can be refreshed frequently.
- Today's forecast should expire quickly.
- Weather answers should include observation or forecast time.

Manual or user-submitted evidence:

- Can support private trip answers.
- Should not become public unless the user or provider grants publication rights.

## Usage Meters

The base paid pass should meter expensive operations separately from ordinary chat.

```text
trip_usage_meters
  trip_id
  meter_type
  used
  limit
  reset_at
  updated_at
```

Initial meters:

- `chat_message`
- `live_refresh`
- `heavy_recommendation`
- `weather_refresh`
- `route_lookup`

When the live refresh limit is reached, the assistant can still answer from existing facts, but it should not fetch new expensive provider data without an extension or upgrade.

## Payment Flow

1. User gets a free preview chat.
2. A request needs live evidence, recommendation ranking, reviews, or multiple provider calls.
3. App shows the Siargao Trip Pass paywall.
4. User pays through Stripe Checkout.
5. Verified Stripe webhook activates the trip pass.
6. Usage meters are initialized for the pass duration.
7. Paid chat can use live refreshes until limits are reached.

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

## Testing Decisions

Test the request lifecycle at the highest practical seam:

- free chat creates trip context
- missing fresh facts trigger allowed provider calls
- fresh facts avoid provider calls
- provider results normalize into facts
- usage meters increment correctly
- live refresh limits block expensive calls
- paid pass activates only from verified Stripe webhooks
- source policies prevent restricted raw data from public surfaces
- answer context includes freshness and confidence

Provider adapters should have focused unit tests for field masks, allowed-use checks, normalization, TTLs, and error handling.

## Observability

Track:

- chat starts
- free-to-paid conversion
- paid questions per trip
- live refreshes per trip
- heavy searches per trip
- cost per provider call
- cost per paid trip
- cached-answer rate
- provider error rate
- accommodation resolution success
- fact freshness misses
- user usefulness feedback

The economic dashboard should answer: at the current price, how many average paid users are profitable after Stripe, LLM, and provider costs?
