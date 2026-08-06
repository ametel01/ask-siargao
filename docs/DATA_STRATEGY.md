# Data Strategy: Lazy Siargao Fact Graph

Ask Siargao should build its data asset from real user questions. The product should not start by bulk-indexing every accommodation, restaurant, beach, clinic, event, and operator on the island. It should check the database first, fetch live provider data when needed, normalize useful observations, and retain allowed derived facts for future answers.

## Principle

The durable unit of value is the normalized Siargao fact, not the raw provider response.

```text
user request
  -> fact requirements
  -> fresh DB lookup
  -> live provider call if needed
  -> source observation
  -> entity resolution
  -> normalized facts
  -> answer context
  -> reusable fact graph
```

This approach keeps the product useful before full coverage exists and lets the database grow in the exact areas travelers ask about.

## Storage Layers

### Trip And Chat Memory

Stores user-owned context:

- trip dates or approximate travel window
- accommodation text, link, or resolved entity
- arrival origin or route
- traveler type
- group size and family context
- constraints such as quiet sleep, remote work, surfing, budget, medical access, no scooter, or parties
- chat history
- paid pass state and expiry

Current Priority 2 implementation is request-scoped only. `src/server/chat/intent.ts` derives a
`TripContext` from the bounded chat message window submitted to `/api/chat`; it does not persist
trip context, raw chat memory, browser geolocation, or provider payloads. The derived context
separates stable signals such as current location, area, ride-time limit, transport mode, kids,
budget, no-scooter, and beach constraints from latest-turn temporary modifiers such as open now,
covered, cheaper, rainy day, swimming, sunset, beach suitability, and itinerary changes. Route
weather planning, grounded beach guidance, and Google Places recommendation planning consume that
same request-scoped context so follow-ups can inherit location and constraints without creating new
database tables.

Persistent `trips`, `chat_messages`, `chat_requests`, usage meters, and trip-context snapshots
remain future work. When they are added, they should store user-owned context and message metadata,
then feed the same `TripContext` boundary rather than bypassing it.

### Saved Trip Sharing

Priority 11 adds a narrow saved-plan layer without introducing persistent chat history. The
browser stores selected recommendation cards, itinerary plans, and notes in `localStorage` under an
anonymous `local_trip_*` ID. That ID is not an account identity; the server hashes it before storing
rows in `saved_trips`.

Saved item payloads are deliberately compact:

- recommendation card or itinerary structure;
- map links already approved for display;
- source summaries with label, source name, optional source profile ID, optional freshness
  timestamp, confidence, checked arrays, and not-checked arrays;
- caveats needed to preserve source and safety boundaries.

They must not include:

- full chat transcripts;
- raw provider payloads;
- Google review text or review objects;
- tool-call arguments;
- browser geolocation or exact coordinates;
- unrelated trip context.

Share creation first syncs only the selected saved items to `/api/trips/saved`, then creates a
share token with `/api/trips/share`. Share tokens are stored as hashes. Shared plan lookup returns
only selected saved items, and expired or soft-deleted share tokens return no plan. The public
`/trips/shared/[token]` page uses generic unavailable copy for invalid, expired, and deleted tokens
so token state is not disclosed.

### Entities

Stores canonical things the assistant can reason about:

- accommodation
- restaurant
- beach
- bar or party venue
- event
- motorbike rental
- clinic
- pharmacy
- transport node
- route
- area
- weather location

Entities may have multiple external IDs, aliases, and source records.

### Facts

Stores small claims that can expire and be reused:

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

Every fact should carry:

- entity ID
- fact type
- value JSON
- confidence
- observed timestamp
- expiry timestamp
- source ID
- evidence ID where applicable
- derived request ID
- reuse scope

### Source Observations

Stores provider provenance and short-lived debugging context:

- provider
- source type
- request ID
- external ID
- normalized summary
- raw payload only where allowed
- observed timestamp
- expiry timestamp
- allowed use
- attribution metadata

Source observations are evidence and provenance, not the long-term product truth.

## Reuse Scopes

Facts need explicit reuse rules:

- `global`: internal derived fact can inform future users.
- `trip_only`: fact is tied to one trip or display context.
- `internal_only`: fact may influence reasoning but should not be shown as provider content.
- `public_display`: fact can be shown publicly with required attribution.

This is especially important for Google Places reviews and other licensed provider content.

## Freshness Windows

| Fact type | Suggested freshness |
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

The request planner should compare fact freshness with the user's intent before making a provider
call. This decision is automatic and independent of the traveler's answer balance.

## Provider Priority

Use provider sources based on the type of answer needed:

- Open-Meteo for current and forecast weather.
- Google Places for place identity, location, ratings, review snippets where allowed, opening status, website, and map links.
- Official transport, airport, ferry, municipal, provincial, and tourism sources for routes, rules, fees, closures, and safety.
- User-submitted accommodation links, screenshots, or host answers for private trip context.
- Manual local curation for facts that APIs do not cover well, such as party rhythm, quiet streets, family practicality, and trusted local operators.

Do not scrape prohibited sources. Competitor directories and booking platforms can be research benchmarks or partnership targets, but should not become raw data sources without permission.

### Nightlife And Event Sources

Nightlife questions need event freshness before venue freshness. For "tonight",
"this weekend", "party", "DJ", "live music", "foam party", "pub quiz", or
similar prompts, use this source order:

| Priority | Source class | Use | Freshness |
| ---: | --- | --- | --- |
| 1 | Official venue website or schedule page | Recurring schedule, closed days, official event names | Same-day for `tonight`; 7 days otherwise |
| 2 | Local event directory such as SiargaoVibes | Dated occurrences, upcoming dates, event times | Expires after event end |
| 3 | Official public venue Instagram/Facebook page | Last-minute updates, flyers, guest DJs, cancellations | Same-day for `tonight`; 24 hours for active posts |
| 4 | Venue-submitted or partner-submitted event | Explicitly permitted event facts | Expires after event end or partner-supplied review date |
| 5 | Local guide or directory such as Siargao Local | Stable venue fit and atmosphere | 30 days for vibe facts |
| 6 | Travel/news articles | Background recurring patterns | 30-90 days, never primary same-day truth |
| 7 | Review/travel platforms | Vibe and atmosphere signals | 14-30 days where terms allow derived use |
| 8 | Reddit/community public chatter | Low-confidence crowd rhythm | 30 days for broad rhythm; not same-day truth |
| 9 | YouTube/travel blogs | Discovery and atmosphere | 30-90 days, not event proof |
| 10 | Google Places | Venue identity, map, rating, open-hour signal | Existing Google Places policy |
| 11 | Open-Meteo | Late-night route weather | 1-3 hours |

Store normalized event facts, source URLs, confidence, observed timestamps, and
expiry. Do not store raw social-media bodies, private group content, raw review
corpora, or unrestricted provider payloads. Google Places must enrich selected
venues; it must not be treated as the primary event source.

## Google Places Handling

Google Places should be used as a live provider and identity source, not as a database to clone.

Store:

- Place ID.
- normalized entity identity.
- derived facts with observed timestamp and expiry.
- required attribution metadata.

Avoid:

- indefinite raw payload storage unless allowed.
- raw review corpus storage as reusable product data.
- public display of restricted provider content without required attribution and permission.

Use field masks to control cost and scope. Rich review-bearing requests should be reserved for paid or paywall-triggering flows.

The implemented Google Places capture model uses dedicated tables beside the generic fact graph:

- `google_places` stores durable identity rows keyed by `place_id`. This row may survive cleanup
  even when all cached Google content has expired.
- `google_place_snapshots` stores request-scoped captures with the field mask, fetch time,
  `stale_at`, `retention_expires_at`, storage policy, attribution metadata, and policy-limited
  payload JSON.
- `google_place_details` stores typed fields requested from Places, including display name,
  address, location, type, business status, Maps URI, contact fields, opening hours, price fields,
  rating, review count, amenities, payment or parking options, and attribution metadata.
- `google_place_reviews` stores review metadata and text only while the retention policy allows it.
  Review rows carry attribution and must not be treated as permanent public product content.

Freshness and retention are separate decisions. A Google row can be stale before it must be deleted.
The request path must only reuse rows that are both fresh and inside their retention window. Current
policy keeps chat search/details fields on short windows, with ratings and review signals around
seven days, price fields around fourteen days, and address/contact/location-derived Places content
no longer than thirty days unless replaced by owned or otherwise permitted data.

Chat recommendation requests now go through `AnswerContextStore`: plan the Google Places
requirement, check fresh Postgres captures first, refresh through the Google adapter only when
allowed, persist the capture, and return bounded facts, evidence summaries, freshness labels, and
gaps to the LLM. The LLM should not receive unrestricted Google payloads or invent live-provider
claims when the answer context reports missing, stale, blocked, or failed refreshes.

Priority 1 live local recommendations use the chat route's `PlaceIntent` classifier and the Ask
Siargao chat evidence policy before final model response. Food, cafe, bar, activity-place, service,
and specific-place identity requests are searched through the cache-first Google Places chat
adapter.
Fresh cache rows are reused when they meet the configured minimum and can satisfy live-status
needs; partial, stale, expired, or open-now/hour-insufficient cache rows refresh through the live
adapter and are persisted through the same Google Places retention policy. Ranked candidates are
normalized into `LocalRecommendation` objects before markdown rendering. The current renderer
outputs numbered markdown recommendations with fit reasons, open/closed/unknown hour signals,
ratings when available, addresses when available, map links, and explicit `Checked:` /
`Not checked:` caveats. Priority 4 card UI remains a future surface; these normalized objects are
card-ready but still rendered as markdown today.

Operators should run `bun run db:prune:google-places -- --dry-run` before destructive cleanup and
`bun run db:prune:google-places` after validating the counts. Cleanup deletes expired reviews,
details, and snapshots, but preserves durable `google_places.place_id` identity rows.

Do not promote Google review text, raw Places payloads, or other restricted Google content to
public pages or indefinite product data unless the project's Google agreement explicitly allows
that use and the UI carries required Google attribution.

## Fact Acquisition Decision

For each request:

```text
1. classify intent
2. resolve trip context
3. map intent to required fact types
4. query facts by entity, area, freshness, confidence, and reuse scope
5. if facts are enough, answer from DB
6. if not enough, check source policy and provider cost controls
7. call provider adapters only when permitted
8. normalize observations into facts
9. store evidence and attribution
10. answer with confidence and freshness
```

The system should avoid provider calls when the cached answer is fresh enough. It should also avoid silently answering from stale facts when the user clearly needs current data.

## Cost And Rate-Limit Strategy

Track every answer and evidence operation for internal cost analysis:

- chat messages
- live evidence refreshes
- heavy recommendation searches
- weather refreshes
- route lookups
- estimated provider cost
- estimated LLM cost

The customer-facing allowance is 10 free travel answers over seven days or 150 travel answers in a
`$9.99` USD, 14-day Trip Pass. Evidence operations remain observable for unit economics but do not
consume separate traveler allowances. Provider failures should fall back to governed cached facts
with truthful freshness and availability boundaries.

## Public Data

Public pages and public APIs should come later than the chat product. When added, they must use only facts marked `public_display` or otherwise approved for public republication.

Saved trip share pages are public surfaces, but they are not public knowledge pages. They are
traveler-created, noindex shared artifacts. They can display selected saved cards and itineraries
with permitted source summaries, freshness, checked/not-checked labels, caveats, and map links.
They must follow the same private-data exclusions below.

Never expose:

- private trip messages
- paid chat history
- raw restricted provider payloads
- non-republishable review text
- low-confidence claims without caveats
- exact browser geolocation or tool-call arguments

## Implementation Milestones

1. Add trip and chat memory tables.
2. Add usage meters for trip passes.
3. Build the `FactStore` interface for DB-first answer context.
4. Add Google Places live lookup behind source policy and field masks.
5. Normalize live provider results into entities, source observations, and facts.
6. Add freshness windows by fact type.
7. Add Open-Meteo weather refresh to the same answer-context flow.
8. Add paywall triggers for live evidence and heavy recommendations.
9. Add cost logging per request.
10. Add local curation tables for high-value Siargao facts APIs do not cover.

## Validation Metrics

Track:

- percentage of answers served from fresh DB facts
- provider calls avoided by cached facts
- provider calls per paid trip
- cost per paid trip
- fact reuse rate
- stale fact rate
- source-policy blocks
- accommodation resolution success
- answer usefulness rating
- conversion from free preview to paid pass

The data pipeline is working when each paid trip leaves behind normalized facts that make future similar questions cheaper and better.
