# Ask Siargao Data Pipeline

Ask Siargao operates as an on-demand Siargao judgment assistant, not as a risk-report product or an
always-running tour operation. The primary product surface is chat: travelers explicitly submit an
accommodation, itinerary, immediate plan, surf session, disruption, or practical island question.
Risk is one input to a structured keep/change/avoid/needs-confirmation decision, not the product
itself.

The data system should use a lazy acquisition model. The app should not bulk-index every possible restaurant, hotel, beach, operator, and event before users ask for them. It should answer from fresh internal facts when they exist, fetch live provider data when facts are missing or stale, normalize the useful result, and keep the normalized facts for future answers.

## Product Direction

The assistant should answer broad Siargao trip questions:

- whether an accommodation is likely to provide quiet sleep
- whether an area or property is family-friendly
- what parties or events are worth attending during the stay
- which restaurants, beaches, clinics, pharmacies, scooter rentals, and transfer options are nearby
- how to get from the airport or port to the accommodation
- how weather affects today's plan
- what itinerary changes better match the traveler's requirements

The durable product promise is request-time local operating judgment: a traveler can paste an
existing plan and get practical Siargao-specific guidance that accounts for dates, accommodation,
traveler profile, constraints, current evidence, transport, and nearby services. The app acts only
on the submitted request; it does not promise later monitoring, outreach, or intervention.

The paid product is a Trip Pass for more request-driven travel answers, not an audit or operator
retainer. Evidence tools run automatically when a submitted question needs them and policy permits
them; customers do not buy or select individual provider refreshes.

## Lazy Data Flow

Every chat request should pass through the same data loop:

```text
user message
  -> extract trip context and intent
  -> determine required fact types and freshness
  -> query internal fact store
  -> answer from fresh facts when sufficient
  -> fetch provider data when facts are missing, stale, or too weak
  -> normalize provider observations into entities and facts
  -> store provenance, freshness, confidence, and reuse policy
  -> answer with source freshness and confidence
```

The agent owns tool choice and its natural-language queries. Deterministic tool and provider
boundaries still decide whether cached facts satisfy the request, whether a live call is allowed by
source policy and cost controls, and which results can be displayed or reused. Narrow required-
evidence repair can fill an omitted mandatory check, but it does not turn the route into a general
intent-to-tool classifier. The traveler does not choose a deep-search mode.

## Storage Layers

Use three storage layers with different purposes and retention rules.

### Trip And Chat Memory

Trip memory stores user-owned context and conversation state.

```text
trips
  id
  user_id
  starts_on
  ends_on
  accommodation_text
  accommodation_entity_id
  traveler_profile_json
  created_at
  expires_at

chat_messages
  id
  trip_id
  role
  content
  created_at

chat_requests
  id
  trip_id
  user_message_id
  intent
  required_freshness
  evidence_tools_used_json
  estimated_cost_cents
  created_at
```

This layer answers: who asked, what trip context applies, what the assistant already knows about the
traveler, and which evidence tools supported each answer.

### Normalized Destination Facts

Facts are the durable application data. They should represent Siargao judgments and small factual claims, not raw provider payloads.

```text
entities
  id
  type
  canonical_name
  area_id
  status

entity_external_ids
  entity_id
  provider
  external_id
  observed_at

facts
  id
  entity_id
  fact_type
  value_json
  confidence
  observed_at
  expires_at
  source_id
  derived_from_request_id
  reuse_scope
```

Useful fact types include:

- `quiet_sleep_signal`
- `family_fit_signal`
- `nearby_noise_source`
- `restaurant_recommendation`
- `nearby_beach`
- `nearby_clinic`
- `scooter_rental_reliability`
- `airport_transfer_option`
- `event_occurrence`
- `today_weather_forecast`

Facts should be reusable only when their `reuse_scope` allows it:

- `global`: safe internal derived fact that can inform future users.
- `trip_only`: tied to one traveler, trip, or provider display context.
- `internal_only`: may inform model reasoning but should not be displayed as provider content.
- `public_display`: allowed to show to users with required attribution.

### Source Observations

Source observations preserve provenance and debugging context. They are not the product truth.

```text
source_observations
  id
  provider
  source_type
  request_id
  external_id
  raw_payload_json
  normalized_summary_json
  observed_at
  expires_at
  allowed_use
  attribution_json
```

Provider payload storage must follow each source profile. For Google Places, store Place IDs as durable identifiers, but do not treat raw place content or reviews as a permanent reusable database. Keep raw payloads short-lived or trip-scoped unless the provider terms explicitly allow broader retention. Store derived Siargao facts separately with their own confidence, timestamp, and allowed reuse.

The current Google Places implementation stores provider-specific captures in typed tables before
normalizing reusable facts:

```text
google_places
  place_id
  resource_name
  latest_source_record_id
  canonical_entity_id
  first_seen_at
  last_seen_at
  last_details_fetched_at
  details_stale_at

google_place_snapshots
  id
  place_id
  source_record_id
  request_kind
  field_mask
  payload_json
  payload_hash
  fetched_at
  stale_at
  retention_expires_at
  storage_policy
  attribution_json

google_place_details
  place_id
  display/contact/location/rating/price/opening-hours fields
  fetched_at
  stale_at
  retention_expires_at

google_place_reviews
  id
  place_id
  snapshot_id
  review metadata and optional text JSON
  fetched_at
  stale_at
  retention_expires_at
  display_requires_google_attribution
```

`google_places.place_id` is the durable identifier. Expired snapshots, typed details, and review
rows are cache content and must be pruned when `retention_expires_at` passes.

## Freshness Policy

Freshness should vary by fact type:

| Fact type | Suggested freshness window |
| --- | ---: |
| today weather forecast | 1-3 hours |
| party or event occurrence | expires after event |
| restaurant hours, rating, or review signal | 7 days |
| accommodation rating or review-derived signal | 14-30 days |
| scooter rental reliability signal | 14-30 days |
| airport or port transfer guidance | 30-60 days |
| clinic, pharmacy, or hospital identity | 30-90 days |
| beach, area, and geography facts | 90+ days |
| manually verified local fact | until review date |

The request planner should compare the user's intent with these windows before calling a provider. For example, today's weather should refresh aggressively, while a beach location fact can be reused for much longer.

## Provider Calls And Normalization

Provider adapters should produce normalized observations, not final answers.

For Google Places requests, the normal path is:

```text
chat request
  -> AnswerContextStore plans a Google Places requirement
  -> fresh typed Google rows are queried first
  -> live Google adapter is called only when rows are missing, stale, expired, or insufficient and refresh is allowed
  -> capture is persisted into Google tables and source_records/facts/evidence
  -> bounded answer context is returned to the LLM
```

The app should avoid one-off provider calls that only answer the immediate chat and then disappear. If a paid user asks for "best quiet hotels near General Luna", the system should keep useful derived outputs such as:

- candidate accommodation entities
- Google Place IDs
- area match
- rating and review-count signals when allowed
- quiet-sleep derived signal
- family-fit derived signal
- source timestamp
- attribution and display constraints

The next user who asks a similar question can then be answered from internal facts if the freshness and reuse policy allow it.

Google field masks are centralized in `src/server/providers/google-places-policy.ts`. Production
helpers use explicit chat-search, details, enterprise, and atmosphere/review masks rather than `*`.
The policy module computes `stale_at` separately from `retention_expires_at`, and reuse checks must
reject expired rows even if a durable Place ID remains.

## Answer Context Interface

Callers should not know whether data came from Postgres, Google Places, Open-Meteo, manual curation, or another adapter. Keep that complexity behind a small fact-store interface.

```ts
type AnswerContextRequest = {
  messages: readonly AskSiargaoChatMessage[];
  tripId?: string;
  userMessageId?: string;
};

type AnswerContext = {
  facts: AnswerFact[];
  evidence: EvidenceSummary[];
  gaps: FactGap[];
  sourceFreshness: SourceFreshness[];
  liveRefreshCount: number;
  estimatedProviderCostUsd: number;
};
```

The module behind this interface should:

- resolve the trip and accommodation context
- check freshness and confidence
- decide whether provider calls are permitted
- call provider adapters when needed
- normalize observations into facts
- enforce provider reuse and display constraints
- return bounded context to the LLM

The LLM should receive facts, evidence summaries, gaps, and confidence labels. It should not receive unrestricted provider payloads when a narrower answer context is enough.

The `/api/chat` route injects an `AnswerContextStore` dependency for Google Places recommendation
questions and passes only the returned `answerContext` into the chat adapter. The chat adapter's
prompt rules require provider-specific claims to come from that bounded context, require gaps to be
stated instead of invented, and require Google Maps links or attribution when the source context
requires them.

## Google Places Retention Operations

Google Places cleanup is an explicit operator action:

```sh
bun run db:prune:google-places -- --dry-run
bun run db:prune:google-places
```

The dry run counts expired `google_place_reviews`, `google_place_details`, and
`google_place_snapshots` rows at the current time without deleting. The destructive run deletes in
foreign-key-safe order: reviews first, details second, snapshots last. It does not delete
`google_places`, so durable `place_id` rows survive and can be refreshed later.

Run prune only after migrations and source policy are understood for the target database. Do not
promote Google review text, raw Places payloads, or other restricted Google content to public pages
or retain it indefinitely unless the project's Google agreement explicitly allows that use.

## Rate Limits And Profit Protection

The version 2 paid pass has one customer-facing limit: 150 travel answers over 14 days. The free
experience includes 10 travel answers over seven days.

Model these as trip-level meters:

```text
trip_usage_meters
  trip_id
  meter_type
  used
  limit
  reset_at
  updated_at
```

The current grant initializes only `chat_message`. Legacy `live_refresh`,
`heavy_recommendation`, `weather_refresh`, and `route_lookup` rows remain readable for version 1
orders and reconciliation, but the current chat runtime does not enforce them.

Paid generation first opens a durable `paid_answer_reservations` row under the account and Trip
Pass Product Family transaction lock. Open reservations reduce the displayed remaining allowance
before model or tool work starts. The assistant message, one settled usage event, the incremented
meter, and the exact public replay payload then commit in one PostgreSQL transaction. Failure,
policy refusal, empty output, expiry, closure, refund, or dispute loss leaves the meter unchanged;
database-time lease recovery fences stale workers. Redis continues to enforce burst and concurrency
controls, but it is not the source of truth for the commercial answer balance.

Weather, Places, surf, events, public evidence, and route reasoning run automatically when needed
and allowed. Provider rate limits and cost circuits protect unit economics independently of the
traveler's answer balance.

## Paywall Logic

Free mode should demonstrate the real product:

- parse the user's trip prompt
- detect accommodation or area when possible
- run appropriate evidence checks automatically
- give an evidence-aware answer with truthful availability boundaries

The paywall should trigger after the 10 free travel answers are used, not because a request needs a
particular tool or research depth.

The paywall copy should frame the unlock as more request-time Siargao judgment:

```text
Unlock your Siargao Trip Pass for more on-demand reality checks across stays,
itineraries, today's conditions, surf sessions, and disrupted plans.
```

## Relationship To The Existing Fact Graph

The existing autonomous fact graph remains useful, but the default acquisition strategy should change:

- Start with lazy, demand-driven provider calls.
- Promote repeatedly requested facts into durable global facts when allowed.
- Keep provider payloads governed by source profiles and retention rules.
- Keep manual curation for high-value local facts that APIs do not cover well.
- Avoid pretending the product has complete island coverage before user demand proves which data matters.

This lets the assistant become more useful over time without requiring a full up-front data indexing program.
