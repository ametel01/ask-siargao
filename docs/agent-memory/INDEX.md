# Ask Siargao Agent Memory Index

## Purpose

This is the only domain-memory file that should be loaded into the model by default.
Use it to choose which detailed memory files to load before answering. Memory is
policy and local-reference context only; live/current facts still require tools.

## Loading Rules

- Load the smallest set of files that can answer the user's latest request.
- For surf, beach, weather-sensitive, safety-sensitive, source, tool-use, or
  current public-web research questions, load the relevant file before the final
  answer.
- Do not load surf or beach memory for ordinary food, breakfast, cafe,
  restaurant, bar, or open-now place prompts unless the user explicitly asks for
  surf or beach context.
- Load nightlife memory for party, nightlife, bar-hopping, DJ, live music, foam
  party, pub quiz, trivia, late-night, or drinks-tonight prompts. Nightlife
  memory is stable local context only; current events still require governed
  tools.
- Do not answer from general model knowledge when a memory file below covers the
  topic.
- If no memory file covers the topic, say the knowledge is not available from Ask
  Siargao memory and use governed tools only where appropriate.
- For current/date-specific schedules, prices, availability, closures,
  disruptions, advisories, events, and current comparisons, use `research_web`
  before accepting a final answer. Memory is not a substitute for public web
  research. For restaurant, cafe, or food recommendations, try `research_web`
  first when current editorial evidence matters; if it is unavailable or
  insufficient, a successful `search_places` result may still support a clearly
  Google-metadata-based ranking with menu and table-availability caveats.

## Files

### SURF.md

Use for surf spots, surf-break alternatives, skill-level matching, Pacifico,
Cloud 9, General Luna surf zones, beginner/intermediate/advanced surf
recommendations, surf spot caveats, and distinguishing surf breaks from normal
beaches.

For "closest surf spots near me", "nearest surf", or similar browser-location
requests, load `SURF.md` and call `rank_surf_spots_nearby` before the final
answer. Use the tool's km distances for the nearest list; do not infer General
Luna, Cloud 9, or any other named base from memory alone.

### LOCAL_GUIDE_BEACHES.md

Use for beach-day recommendations, swimming beaches, sandy/rocky beach tradeoffs,
quiet beaches, family beach choices, island beaches, sandbars, beach access
patterns, and when a place is a beach fallback rather than a surf spot.

### NIGHTLIFE.md

Use for General Luna nightlife, party-route answer shape, bar-hopping context,
recurring party-night candidates, venue-fit notes, nightlife source priority,
and boundaries between stable nightlife memory and live event evidence.

For "party tonight", "nightlife tonight", "where should we go out", "DJ",
"live music", "foam party", "pub quiz", or similar prompts, load
`NIGHTLIFE.md` before the final answer. Then use current event, Google Places,
and weather tools where relevant; do not treat memory as live event proof.

For same-day nightlife prompts, `research_web` and current event checks come
before Places and weather. Places enriches researched venues only.

### ASK_SIARGAO_TOOL_USE_POLICY.md

Use for deciding which backend tools are required for weather, tide, marine,
condition, Google Places, local guide, itinerary, database, source evidence, or
agent-memory retrieval questions. Also use for current public-web research
requirements and the ordering between `research_web`, Places, weather, memory,
and local-guide tools.

### ASK_SIARGAO_SOURCE_POLICY.md

Use for source-boundary wording, source-label meaning, confidence boundaries,
provider caveats, and preventing memory or generic reasoning from becoming live
evidence.

Also use for public web source labels, weak web evidence, and overclaiming
rules around `web_researched`, `official_checked`, `directory_checked`, and
`insufficient_web_evidence`.

### ASK_SIARGAO_DATA_DICTIONARY.md

Use for safe chat runtime surfaces, database/local-fact boundaries, tool-facing
data contracts, and what can or cannot be queried.

### ASK_SIARGAO_LOCAL_ASSUMPTIONS.md

Use for stable planning assumptions such as common traveler bases, ride-time
caveats, weather-sensitive planning, ocean-safety caveats, and General Luna /
Cloud 9 defaults when the user gives no better base.

### ASK_SIARGAO_AGENT_SKILLS.md

Use for answer style, role/scope, final-answer expectations, surf-timing answer
shape, and practical condition-answer phrasing.

### ASK_SIARGAO_ANSWER_PATTERNS.md

Use for request-type answer shape across place, food, cafe, bar, service,
activity, weather, condition, surf, tide, beach, swimming, transport,
logistics, accommodation-area, itinerary-review, safety, medical, and urgent
local-service questions.

Also use for ranked research-backed answer shapes and the failure shape when
current public evidence is insufficient or unavailable.
