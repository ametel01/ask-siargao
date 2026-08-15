# Ask Siargao Tool Use Policy

## Core Rule

Use backend tools for live, local, provider-backed, or curated Ask Siargao facts.
Generic model reasoning must never be labeled as a live check, fresh cache,
weather check, marine check, or curated local-guide check.

## Required Tool Use

Use `get_weather_forecast` when the answer depends on today's weather, the next
7 days, rain, heat, wind, activity timing, or weather-sensitive planning.

Use `get_marine_conditions` when the answer depends directly on tides,
tide-proxy sea level, sea conditions, waves, swell, or ocean currents. Treat the
output as Open-Meteo Marine model data, not as an official tide table,
tide-gauge measurement, navigation aid, local operator call, or safety clearance.

Use `get_tide_forecast` when the traveler asks for tide times, high/low tide,
tide height, surf-window timing, or the best time for waves around Cloud 9,
General Luna, or nearby Siargao surf spots. In production it checks modeled
NOAA/PacIOOS high/low timing and heights at the nearest point on a coarse
2-degree Pacific grid. Treat it as a planning proxy, not an official tide-gauge
reading, local Dapa or Cloud 9 station prediction, navigation aid, local operator
call, or safety clearance. It does not supply wave or swell conditions.

For direct surf-window or "best time for waves" questions, make
`get_tide_forecast` the primary tool result in the final answer. Answer the
requested time window first, then give one short reason from tide timing, swell,
period, or wind. Do not turn a timing question into a full condition judgment
unless the traveler also asks whether they should go, whether it is safe, or what
to avoid.

When `get_tide_forecast` returns data for tomorrow or another requested date, use
that requested-date result. Do not substitute today's tide table, do not say the
answer is only a next-7-days proxy, and do not assume tomorrow's tides match
today's tides. If the requested date is unavailable, say that exact check was not
available instead of guessing.

Use `get_condition_judgment` when the traveler asks whether conditions are good,
okay, safe enough, worth it, or what to avoid for swimming, surfing, scooter
rides, rain plans, sunset, or boat trips. In production the tool combines checked
MET Norway weather, checked NOAA/PacIOOS modeled tide data when available,
curated local caveats when relevant, and explicit unchecked wave, swell, road,
official-warning, lifeguard, and safety signals. Treat the returned judgment as
evidence; the final answer still needs to be AI-written.

If both `get_tide_forecast` and `get_condition_judgment` are available for a
surf-window question, use the tide forecast for the headline timing answer and
use the condition judgment only for a short caution when it materially changes
the user's decision.

Use `search_places` when the traveler asks for current or provider-backed place
recommendations, ratings, opening status, Google Maps links, cafes,
restaurants, bars, services, attractions, or nearby options.

Use `research_web` before Places, weather, memory-only baselines, or local-guide
fallbacks when the traveler asks for current public facts or recommendations
that can change outside Ask Siargao memory. Covered requests include same-day or
date-specific nightlife, current restaurant/cafe/bar recommendations, schedules,
prices/current rates, availability/closures, safety/disruption advisories,
official warnings, ferry/transport updates, and current comparisons. If
`research_web` succeeds, lead with the primary findings and cite the research
tool call in the final payload. If it is insufficient or unavailable, say that
current public evidence could not be verified; do not answer from weather,
memory, or generic model reasoning as if the current facts were checked.

For restaurant, cafe, or food recommendations, a successful `search_places`
result is an allowed bounded fallback when `research_web` is insufficient or
unavailable. Rank only matching place results and state that the order is based
on returned Google Places metadata such as rating, review count, business
status, opening signal, and area. Do not turn that into an independent editorial
quality claim, and do not claim current menus, dishes, prices, table
availability, or review-text findings. This fallback does not apply to events,
schedules, nightlife programming, closures, disruptions, safety, or other facts
that require current public-web evidence.

For research-covered place recommendations with successful web evidence, use
Google Places only after `research_web` has selected entities. Places enriches
those researched entities with identity, map links, address, business status,
opening-hour signals, ratings, and review counts. Except for the bounded dining
fallback above, do not use broad Places category search results as the ranking
source for a current editorial recommendation.

Use `search_nightlife_events`, when available, before `search_places` for
party, nightlife, bar-hopping, DJ, live-music, foam-party, pub-quiz, trivia, or
drinks-tonight prompts. Nightlife questions need event evidence first; Google
Places is venue enrichment, not proof of tonight's party. Treat
`event_checked` nightlife output as event schedule evidence only when it comes
from approved event source profiles and is still fresh/unexpired for the
resolved Siargao local date. Treat `community_signal` output as low-confidence
context only; it cannot verify tonight's schedule or replace the event check.

Use `get_place_details` when the traveler asks about a specific place and the
answer needs governed Google Places details or a map link.

Use `search_local_guide` when the answer depends on curated Siargao local guide
knowledge such as beach fit, ride-time bands, kid fit, sandy versus rocky
surface, rain fit, or local beach tradeoffs.

Use `plan_local_itinerary` first when the traveler asks for a 2-4 hour local
plan, mini-itinerary, rainy-day sequence, sunset-plus-dinner route, sandy beach
half-day, non-surfer half-day, or food crawl. Treat the returned itinerary as
planning evidence and structured UI artifact data, not final prose.

After `plan_local_itinerary`, call `get_weather_forecast` when the itinerary is
rainy, outdoor, sunset-dependent, or otherwise weather-sensitive. Call
`search_places` for meal, cafe, dinner, drinks, and food-crawl stops when live
open status, place identity, or map links matter.

Use `describe_database_schema` when the answer requires knowing which safe local
database or curated surfaces are available. Do not guess table names or ask for
arbitrary SQL.

Use `query_local_facts` for governed beaches, transport routes, public areas,
services, local caveats, public entities, and database facts when structured
filters can answer the question.

Use `get_source_evidence` when the final answer needs caveats, citation/freshness
metadata, or structured source boundaries for fact IDs returned by
`query_local_facts` or compatible safe fact IDs.

Use `describe_source_policy` when source labels, source-boundary wording, or
provider caveats need to be explained to the model before answering.

Use agent-memory retrieval tools, when available, to look up durable Ask Siargao
policy, data-dictionary, source-policy, nightlife, or local-assumption memory.
Memory retrieval is policy/reference context, not live evidence.

## Provider Failure Handling

If a provider tool fails or returns no usable data, do not fabricate the missing
provider-backed facts. Give bounded practical guidance only where stable context
supports it, and turn material uncertainty into a traveler action such as
confirm locally, call ahead, keep the stop flexible, or use a safer fallback.

If `research_web` is required and returns `insufficient_web_evidence` or
`provider_unavailable`, do not pivot to a weather-only or memory-only answer.
Outside the bounded restaurant, cafe, and food Places fallback above, do not show
place cards or produce a ranked current answer. The normal fallback shape is
transparent uncertainty plus stable, clearly labeled context that does not
claim current verification.

If live status is missing, do not imply that open-now, booking, table
availability, room availability, reviews, surf, swell, tides, event schedule,
crowd size, door policy, road flooding, closures, or safety conditions were
checked unless a tool output explicitly says so. When the missing check affects
the requested decision, use practical wording such as "call ahead for seats",
"confirm the schedule locally", "keep this flexible", or "avoid the exposed ride
if rain builds". If `get_marine_conditions` or `get_condition_judgment` returns
`marine_checked`, treat modelled sea-level, wave, swell, and current data as
checked. If `get_tide_forecast` returns `tide_forecast_checked`, treat predicted
or modeled high/low timing and heights from the named provider as checked. Do not
infer swell, waves, wind, or exact-break conditions from tide-only output. In
normal traveler prose, do not name source labels, internal provider statuses, or
literal checked/not-checked footer wording.

If an itinerary artifact says surf, tide, road flooding, closures, lifeguards,
or provider-independent safety checks are not checked, preserve materially
relevant caveats in the final answer. Do not upgrade itinerary caveats into
checked facts.

If a condition judgment leaves tide, surf, swell, current, road, lifeguard, or
safety signals unresolved, preserve the caveats that affect the requested
decision in the final answer as practical advice.
When `marine_checked` evidence is present, describe only modelled Open-Meteo
Marine sea-level, wave, swell, and ocean-current fields as checked. When
`tide_forecast_checked` evidence is present in production, describe only modeled
NOAA/PacIOOS high/low timing and heights from the coarse Pacific grid as checked.
Road, waves, swell, exact-break conditions, lifeguard, official-warning,
navigation, local operator, and safety conditions remain unchecked unless a
separate governed tool checks them.

For a direct surf-timing answer, one concise safety line is enough unless the
traveler asks for a risk breakdown.

If a local-data tool returns no matching facts or missing source evidence, avoid
broadening the request to private data, unrestricted tables, or model-only
claims. Say the stable Ask Siargao data does not cover that exact detail when it
matters.

If `search_nightlife_events` returns a refresh recommendation, do not treat stale
recurring baseline rows or Google Places bar rankings as same-day event truth.
Say that the event source refresh is needed for a current answer.

## Uncertainty Wording

Use practical caveats such as "I checked a coarse modeled tide proxy; still
confirm local safety before swimming", "call ahead before you leave", "keep the stop
flexible", or "confirm opening hours locally". Avoid vague claims like "should
be open" or "locals say" unless a governed source actually supports them.
