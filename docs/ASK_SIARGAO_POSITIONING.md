# Ask Siargao Positioning Against General AI Assistants

## Summary

Ask Siargao should not compete with ChatGPT or Claude as a smarter general chatbot.
That is a losing position.

Ask Siargao should compete as:

> The Siargao trip copilot that uses AI plus live local tools to decide what is
> open, nearby, safe, weather-appropriate, and locally sensible right now.

ChatGPT and Claude are broad AI assistants. They are strong at general reasoning,
writing, coding, search, image and file understanding, and broad problem solving.
Ask Siargao should win through a focused agent experience: the AI knows Siargao,
can retrieve live local data, can inspect governed local knowledge, and can turn
that evidence into a practical decision.

The product should feel less like a generic AI chat box and less like a preset
rules chatbot. It should feel like a local travel agent with tools.

## Non-Negotiable Product Direction

Every chat response must go through the AI.

The backend must not fulfill user requests by matching words and returning
off-the-shelf responses. Deterministic code may retrieve data, enforce source
policy, validate outputs, and execute tools, but it must not be the user-facing
writer.

The AI should decide when it needs:

- weather data;
- Google Places data;
- curated Siargao knowledge;
- database facts;
- source and provider caveats;
- follow-up clarification.

The backend should expose those capabilities as tools. The AI should call the
tools, inspect the results, and write the answer.

## Competitive Position

### ChatGPT And Claude Strengths

ChatGPT and Claude are already proven, widely used products. They are hard to
beat on:

- General reasoning and conversation quality.
- Broad web knowledge.
- Writing, summarization, and planning.
- Coding and analysis.
- Voice, image, file, and workspace features.
- User familiarity and trust in the base assistant experience.

Ask Siargao should use LLMs as infrastructure, not treat generic model quality as
the only differentiator.

### Ask Siargao's Winning Surface

Ask Siargao can be better when the user's question is practical and local:

- "What should I do near Cloud 9 right now?"
- "Where can I eat nearby that is open?"
- "Is this beach good for swimming or rocky?"
- "What should I do if it rains?"
- "Which options are close enough by scooter?"
- "Can I trust this plan with current weather and local constraints?"
- "What is the actual party route in General Luna tonight?"
- "Where is the main DJ/live-music/foam-party move this week?"

The user should choose Ask Siargao when they need a fast, grounded Siargao
decision, not a broad brainstorm.

## Current Product Strengths

Ask Siargao already has foundations that generic assistants do not have by
default:

- Google Places-backed restaurant and cafe retrieval.
- Open-Meteo weather ingestion.
- Curated beach guidance around General Luna.
- Source-governed fact and evidence tables.
- Google Places cache and retention policy.
- Siargao-specific scope guardrails.
- Source caveats that distinguish checked data from unchecked assumptions.
- Agent-memory files for stable local knowledge that can be loaded by request
  context.

The major current nightlife gap is that Google Places can identify bars, but it
does not know the island's party flow. Nightlife answers need event sources and
route-style synthesis, not a top-rated bar directory.

These are the right ingredients. The product direction now is to put them behind
an AI tool-calling agent, not behind deterministic answer templates.

## Current Weakness

The current product can feel like a 2000s keyword chatbot when backend branches
recognize words and return preset wording.

That weakens the product because:

- repeated follow-ups sound templated;
- weather details can be over-explained without judgment;
- local guide answers can repeat almost identical text;
- deterministic branches decide the shape of the response before the AI has
  participated;
- users can see that the system is matching categories instead of thinking.

To justify choosing Ask Siargao over ChatGPT or Claude, the product must behave
like an AI agent with local tools, not a rules engine with AI fallback.

## Product Promise

A strong product promise:

> Ask Siargao gives you practical, current trip decisions for Siargao by letting
> an AI agent retrieve live local data, read curated Siargao knowledge, and explain
> the best next move in plain language.

Avoid generic positioning such as:

> AI travel assistant for Siargao.

Avoid deterministic positioning such as:

> Local chatbot that routes requests to provider templates.

Neither creates enough distance from ChatGPT, Claude, Google, Tripadvisor, local
directories, or old-style scripted chatbots.

## Differentiation Principles

### AI-Led Conversation

The AI must participate in every user interaction and write every final answer.

The backend can prepare tool definitions, execute retrieval, enforce policy, and
return structured data. It cannot be the final conversational layer.

### Tool-Using Local Intelligence

Ask Siargao should give the AI tools for:

- live weather;
- live and cached places;
- local curated guide data;
- governed database facts;
- source and freshness inspection;
- trip context and previous conversation state.

The AI should know when to use these tools and when to ask for clarification.

### Specificity

Ask Siargao should know Siargao-specific details that a general assistant will
often blur:

- Which beaches are sandy, mixed, or rocky.
- Which places are realistic within a 30-minute scooter ride.
- Which activities are exposed in rain.
- Which areas are good for sunset versus swimming.
- Which tourist assumptions are wrong, such as treating Pacifico or Alegria as
  quick General Luna hops.

### Freshness

The agent should retrieve live sources when the user's question depends on live
status:

- Open now.
- Nearby.
- Weather today.
- Rain plans.
- Current restaurant or cafe options.
- Tonight's party, DJ, live-music, pub-quiz, foam-party, or event schedule.
- Place existence and map links.

The AI should call backend tools for those checks rather than relying on hidden
backend routing to render an answer.

### Actionability

Every recommendation should help the tourist decide and move:

- Place name.
- Distance from the current context.
- Open signal if available.
- Maps link.
- Why it fits.
- What was not verified.
- Best next action.

### Trust

Ask Siargao should be explicit about evidence:

- Venue details checked.
- Event schedule checked.
- Fresh cache.
- Curated local guide.
- Weather checked.
- Community signal.
- Not checked.
- Needs local confirmation.

Trust labels should be backed by actual tool calls and provider results. Generic
model reasoning must never be labeled as a live check.

## Agent Memory

Ask Siargao needs persistent AI memory, but local Markdown files are not memory
until the app wires them into the model.

The product should maintain Markdown knowledge files such as:

- agent behavior and tool-use policy;
- source-governance policy;
- database/data dictionary;
- Siargao-specific local guide notes;
- nightlife and event-route knowledge;
- answer-quality rules.

These files can be attached to the agent through instructions, OpenAI file
search/vector stores, or backend tools that expose their content. The AI should
use them as durable product knowledge.

## Highest-Leverage Additions

### 1. AI Tool Runtime

Create one primary Ask Siargao agent that has backend tools for weather, places,
curated knowledge, database facts, and source inspection.

This replaces deterministic answer branches with model-selected retrieval.

### 2. Persistent Agent Memory

Give the model durable Markdown knowledge:

- how Ask Siargao should behave;
- how the database is structured;
- when to use each backend tool;
- how to phrase source caveats;
- what local Siargao assumptions are important.

### 3. Live Open-Now Near-Me Mode

Use Google Places through AI-called tools whenever the user asks:

- open now;
- nearby;
- covered;
- beachfront;
- coffee;
- dinner;
- drinks;
- rainy-day place;
- specific places.

The AI should call the Places tool, inspect the results, and write the final
recommendation.

### 4. Nightlife Event Route Mode

For party and nightlife prompts, Ask Siargao should answer the island move:

- warm-up;
- main party;
- late option;
- softer or live-music alternative;
- weather or transport caveat when relevant.

The AI should load nightlife memory, check current event sources, enrich selected
venues with Google Places, and avoid ranking tonight's party from Places results
alone.

### 5. Local Itinerary Builder

Build 2-4 hour plans, not only lists:

- Rainy Cloud 9 afternoon.
- Sunset plus dinner.
- Sandy beach half-day.
- Food crawl in General Luna.
- Non-surfer day.
- Scooter day with realistic distance limits.

Each itinerary should include sequence, travel time, fallback, what to skip, and
source caveats.

### 5. Map-First UX

Every local recommendation should be actionable:

- Map link.
- Distance from current context.
- Open status.
- Fit rationale.
- Save or ask for alternatives.

For tourists, the answer is not complete until they can decide where to go.

### 6. Siargao-Specific Data Packs

Create local datasets for:

- Beaches.
- Surf spots.
- Rainy-day activities.
- Sunset spots.
- Cafes with covered seating.
- ATMs.
- Pharmacies.
- Laundry.
- SIM and phone support.
- Transport and scooter rentals.
- Ferry and airport transfer basics.
- Common tourist traps and safety caveats.

These datasets should be exposed to the AI through tools or retrieval memory, not
used as preset response templates.

### 7. Weather, Tide, And Surf Fusion

A tourist does not only need weather. They need a practical condition judgment:

- Rain chance.
- Wind.
- Tide.
- Surf suitability.
- Swimming suitability.
- Road or flooding caveat.

The AI should retrieve the available condition signals and keep unchecked signals
explicitly unchecked.

### 8. Contextual Follow-Up Engine

The product should reliably understand follow-ups such as:

- nearby;
- not too far;
- open now;
- something covered;
- cheaper;
- with kids;
- not rocky;
- best for swimming;
- best for sunset;
- if it rains.

Context extraction can be structured and deterministic, but the answer still
belongs to the AI.

## Priority Roadmap

1. Complete the AI tool runtime.
2. Add persistent Markdown memory for agent behavior, schema, and source policy.
3. Move local provider and guide access behind AI-callable tools.
4. Add map-first recommendation cards.
5. Add itinerary mode.
6. Add tide, surf, and weather fusion.
7. Add consent-based "near me" geolocation.
8. Add save and share trip plans.

## Product Moat

The moat is not the model alone.

The moat is:

- AI-written conversation quality.
- Siargao-specific structured knowledge.
- Live local provider tools.
- Persistent agent memory.
- Honest source caveats.
- Practical travel decisions in the moment.

ChatGPT and Claude are better general assistants. Ask Siargao should be better at
making the next 2 hours of a Siargao tourist's day easier because its AI agent has
the right local tools and memory.
