# Ask Siargao Agentic Architecture

## Core Decision

Ask Siargao is not a deterministic chatbot with AI attached.

Ask Siargao is an AI travel agent for Siargao. The model must participate in every
user interaction and must write every user-facing answer.

The backend should not decide a final answer by matching words and rendering preset
responses. The backend should provide tools, data access, policy enforcement, and
provider integrations that the AI can call when needed.

## Product Contract

Every chat request follows this contract:

1. The user's message goes to the AI agent.
2. The AI decides whether it needs local data, weather data, place data, curated
   knowledge, or database facts.
3. The AI calls backend tools to retrieve that data.
4. The backend executes tools, validates access, applies source-governance rules,
   and returns structured results.
5. The AI writes the final response in its own words.
6. The backend may validate and attach metadata, but it must not replace the AI
   answer with a deterministic template.

No user-facing response should bypass the AI.

Narrow validation repair exception: for governed evidence contracts such as
local itinerary artifacts and condition judgments, the backend may execute the
missing required tool after the model attempts final prose, then return that
tool output to the model for a revised final answer. This repair path is only a
policy guardrail for missing evidence; it must not render user-facing copy,
must preserve source caveats, and must stay scoped to deterministic route
signals that identify a required evidence contract.

Browser geolocation follows the same boundary. The backend may validate a
consented browser location, decide whether it is usable as a Google Places search
center, enforce no-store privacy policy for exact single-request coordinates, and
attach source metadata. It must return that tool evidence to the model; it must
not render deterministic "near me" final prose.

## Backend Role

The backend is the tool runtime for the agent. It should expose capabilities such
as:

- `get_weather_forecast(location, date_range)`
- `search_places(query, location, radius, constraints)`
- `get_place_details(place_id)`
- `search_curated_siargao_knowledge(query, filters)`
- `describe_database_schema()`
- `query_local_facts(query)`
- `describe_available_tools()`

The backend owns safety, correctness, and governance:

- provider API keys;
- Google Places field masks, freshness windows, and retention policy;
- weather-provider normalization;
- source labels and caveats;
- database access boundaries;
- rate limits and observability.

The model owns conversation, tool selection, synthesis, and final wording.

## Database Access

The AI should know how the local data is structured, but it should not receive
unrestricted production database access.

Preferred access pattern:

- expose read-only domain tools first;
- expose schema descriptions as a tool or persistent memory;
- use allowlisted views for public/local facts;
- validate all query arguments;
- enforce row limits and timeouts;
- return only fields allowed by source policy.

If a SQL-like tool is added later, it must be read-only, constrained to approved
tables or views, parsed before execution, and blocked from mutating statements.

## Persistent Agent Memory

OpenAI models do not automatically read local Markdown files such as `SKILL.md`.
Ask Siargao must wire persistent memory into the agent deliberately.

Use three layers:

1. **Instruction Markdown**
   Small stable files loaded into the agent instructions at startup.

2. **File Search / Vector Store**
   Larger Markdown knowledge files indexed for retrieval, such as local policies,
   data dictionaries, and product behavior guides.

3. **Backend Tools**
   Dynamic knowledge that changes often, such as database schema, provider status,
   weather data, and place search results.

Useful memory files:

- `ASK_SIARGAO_AGENT_SKILLS.md`
- `ASK_SIARGAO_DATA_DICTIONARY.md`
- `ASK_SIARGAO_SOURCE_POLICY.md`
- `ASK_SIARGAO_TOOL_USE_POLICY.md`

These files should teach the agent how to behave, when to use tools, what data
exists, and how to communicate uncertainty.

## Implementation Direction

Replace deterministic answer branches with a Responses API tool loop:

1. Build one Ask Siargao chat agent.
2. Register backend tools with typed schemas.
3. Give the model persistent instructions and memory files.
4. Let the model call tools until it has enough evidence.
5. Require the final response to be model-written.
6. Validate output for scope, safety, and source consistency.

Deterministic code remains useful for tool execution, ranking, validation, and
policy enforcement. It should not be the voice of the product.
