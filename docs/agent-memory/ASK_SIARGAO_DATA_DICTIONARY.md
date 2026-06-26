# Ask Siargao Data Dictionary

## Safe Chat Runtime Surfaces

`src/server/chat` owns the Ask Siargao agent runtime, tool definitions, tool-call
audits, source summaries, source-consistency validation, and route-facing chat
contracts.

Safe chat tools expose only governed, bounded outputs. They do not expose raw
provider payloads, secrets, unrestricted database records, private user data, or
review text.

## Provider Surfaces

`src/server/providers/open-meteo` and related weather snapshot modules provide
Open-Meteo forecast data for known Siargao locations. Weather outputs may support
weather-checked source summaries, but they do not check surf, swell, tides,
road flooding, closures, or local safety conditions.

`src/server/providers/google-places-*` modules provide governed Google Places
search, details, cache, enrichment, retention, attribution, and allowed field-mask
behavior. Chat outputs may include identity fields, ratings, user-rating counts,
opening-hour status when fresh, Google Maps URLs, price-level style metadata when
available, and provider freshness. They must not include review text, booking
availability, table availability, room availability, or raw restricted payloads.

## Local Guide Surface

`src/server/local` owns curated Siargao local guide data such as beach fit,
surface notes, ride-time bands, sunset fit, swimming fit, kid fit, and rain-fit
signals. Curated guide facts are maintained product knowledge, not live
conditions.

## Safe Local Data Tools

Use `describe_database_schema` to inspect the approved local data surfaces before
asking for local facts. It describes the safe tool-facing surfaces `areas`,
`routes`, `curated_local_guide`, `public_entities`, `governed_facts`, and
`source_evidence`.

Use `query_local_facts` for structured local fact retrieval. The only supported
filters are `entityTypes`, `area`, `tags`, `text`, and `limit`. Useful entity
types include `area`, `route`, `beach`, `service`, `place`, `accommodation`,
`operator`, `risk`, and `local_caveat`. Useful tags include examples like
`sandy`, `swimming`, `rain-fit`, `sunset`, and `transport`.

Use `get_source_evidence` only for fact IDs returned by safe local fact tools or
compatible governed fact IDs. It returns display-safe evidence metadata,
freshness/citation caveats, and checked/not-checked boundaries.

## Governed Database Concepts

The repository has fact graph, source profile, provider cache, audit, payment,
job, and public-page tables. Chat tools may use bounded adapters that enforce
source policy, freshness, retention, and field masks.

Unrestricted database access is out of scope for persistent agent memory. Do not
invent SQL-like tools, table-name arguments, production schema introspection, or
arbitrary local-fact queries from this memory layer.

Safe local data tools must not expose private account data, paid audit inputs,
payment records, raw provider snapshots, Google review content, unrestricted
source records, or internal model/tool traces.

## Source Governance

Provider-backed and curated facts must keep their source profile, freshness,
confidence, retention, and checked/not-checked caveats where those concepts are
available. Memory may explain the data model, but memory by itself does not prove
a live/local fact.
