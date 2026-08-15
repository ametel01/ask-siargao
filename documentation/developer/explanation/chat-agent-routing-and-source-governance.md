# Chat Agent Routing And Source Governance

Ask Siargao's chat route gives the model ownership of tool choice while deterministic code owns
input safety, privacy boundaries, artifact selection, and source-label enforcement.

This split keeps `/api/chat` from acting as a hidden tool router. The route can still interpret the
request for logging, persistence, trip context, and safe scope flags, but it does not pass
classifier-owned `intent`, `placeIntent`, `researchIntent`, `conditionActivity`, or
`weatherSensitive` fields to the model.

## Request Boundary

`src/app/api/chat/chat-route.ts` validates the request body, normalizes optional browser
geolocation, derives internal request context, and calls `runAskSiargaoAgentTurn()`.

The model-facing deterministic signals are limited to:

- `clientContext`: privacy-safe browser-geolocation status and consent metadata;
- `context`: safe conversation context such as current area, durable trip constraints, and whether
  browser geolocation may be used as a proximity anchor;
- `scope`: decline or missing-context flags.

Route-derived tool categories remain internal. They are useful for route logs and persistence
summaries, but they are not a contract that forces the model to call web, Places, weather,
condition, memory, or itinerary tools.

## Tool Choice

`src/server/chat/ask-siargao-agent.ts` registers governed tools and instructs the model to choose
the appropriate tool and natural-language query from the traveler's prompt.

The model can call:

- `research_web` for current public evidence, schedules, availability, prices, safety disruptions,
  service lookups, and other public facts;
- `search_places` and `get_place_details` for governed Google Places results and metadata;
- weather, marine, tide, condition, local-guide, itinerary, source-policy, and memory tools when
  the prompt needs them.

Deterministic repair still exists, but it is bounded. It is not route-classifier preflight. Repairs
cover cases where a final answer omits required artifacts or narrowly inferred evidence, such as
browser-location surf ranking, local itinerary artifacts, or condition checks that are directly
asked for in traveler text.

## Provider Failure

Provider-unavailable results stay in the tool transcript. A failed `research_web` or
`search_places` call does not become a terminal hard-coded route answer, and it does not erase
successful evidence from another provider.

For restaurant, cafe, and food recommendations, successful matching Google Places evidence remains
usable when public web research is unavailable. The answer may rank only by returned structured
metadata such as ratings, review counts, business/opening status, and area, and must identify that
basis. It cannot turn the fallback into claims about current menus, prices, table availability,
events, closures, disruptions, safety, or independent editorial quality.

The model should answer from successful evidence when it exists and turn missing checks into
practical caveats only when they matter. If no provider can verify the requested current fact, the
answer must avoid checked or live claims and give a bounded next step such as confirming locally,
calling ahead, or keeping the plan flexible.

## Source Labels

`src/server/chat/source-consistency.ts` enforces public source labels at the route boundary before
the response is returned or persisted.

The important label boundaries are:

- `live_checked` and `fresh_cache` require successful Places or place-details evidence.
- `official_checked`, `directory_checked`, and `web_researched` require successful `research_web`
  evidence.
- `provider_unavailable` is a failure label only. It cannot carry checked facts.
- Memory retrieval can provide context, but it cannot back checked provider labels.
- Legacy/internal rendered `Checked:` source lines must match public structured sources or selected
  public artifacts. They are not normal traveler-facing prose.

Recommendation cards from failed provider outputs are not selectable public artifacts. Failure
sources and unavailable decision summaries may still appear when they support a caveated answer.

## Where To Change Behavior

Use these modules as the ownership map:

- Request validation and route-internal context: `src/app/api/chat/chat-route.ts`
- Model instructions and tool loop: `src/server/chat/ask-siargao-agent.ts`
- Tool definitions and descriptions: `src/server/chat/agent-tools.ts`
- Runtime result shaping and artifact selection: `src/server/chat/agent-runtime.ts`
- Source labels and rendering: `src/server/chat/answer-source-summary.ts`
- Source-governance validation: `src/server/chat/source-consistency.ts`

When adding a new tool or source label, update the tool definition, source summary schema,
source-consistency validation, artifact persistence schemas if public artifacts can contain the
label, and focused tests that prove unsupported labels fail closed.
