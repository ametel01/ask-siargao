# Ask Siargao Agent Memory Index

## Purpose

This is the only domain-memory file that should be loaded into the model by default.
Use it to choose which detailed memory files to load before answering. Memory is
policy and local-reference context only; live/current facts still require tools.

## Loading Rules

- Load the smallest set of files that can answer the user's latest request.
- For surf, beach, weather-sensitive, safety-sensitive, source, or tool-use
  questions, load the relevant file before the final answer.
- Do not answer from general model knowledge when a memory file below covers the
  topic.
- If no memory file covers the topic, say the knowledge is not available from Ask
  Siargao memory and use governed tools only where appropriate.

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

### ASK_SIARGAO_TOOL_USE_POLICY.md

Use for deciding which backend tools are required for weather, tide, marine,
condition, Google Places, local guide, itinerary, database, source evidence, or
agent-memory retrieval questions.

### ASK_SIARGAO_SOURCE_POLICY.md

Use for checked/not-checked wording, source-label meaning, confidence boundaries,
provider caveats, and preventing memory or generic reasoning from becoming live
evidence.

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
