# Web Research Layer

Ask Siargao needs a general web-research layer for current and recommendation-heavy answers. The
current runtime has strong governed tools for memory, Places, weather, local guides, itinerary
planning, and source validation, but it does not have a broad public-web discovery step. That makes
the agent behave like a narrow tool router when the user expects search-and-synthesis.

This is not only a nightlife problem. Nightlife exposed the weakness because Google Places is a bad
ranking source for "where is the party tonight." The same failure mode applies to ferry changes,
restaurant pop-ups, event schedules, tour prices, road closures, safety advisories, surf
competitions, business closures, one-off promotions, and current local recommendations.

## Problem

The current flow is too tool-first:

```text
user message
  -> deterministic intent
  -> required evidence tools
  -> memory / Places / weather / local guide
  -> model answer
```

That works when the right governed tool already exists and its data is fresh. It fails when the
answer depends on public pages that are not in the internal fact store.

The better flow is research-first for current or recommendation requests:

```text
user message
  -> deterministic intent
  -> research need classification
  -> public web research plan
  -> search / fetch / extract / score web evidence
  -> existing tools enrich selected entities
  -> model answer with ranked evidence and caveats
```

Memory should guide the search and interpretation. Google Places should enrich selected entities
with map, hours, and venue metadata. Weather should modify a plan. None of those should replace web
research when the user asks for current public facts.

## What Needs To Change

## Legacy Behavior To Remove

Do not keep the current bad behavior as a fallback. Once `research_web` is available for a request
class, legacy answer paths that bypass research must be removed or made unreachable for that class.

Remove these behaviors:

- broad Places-first recommendation searches for current questions, such as
  `party bars nightlife General Luna Siargao`;
- weather-first final answers for recommendation prompts, unless the user explicitly asked only for
  weather or safety conditions;
- memory-baseline final answers that present stale local patterns as the answer without attempting
  web research;
- generic model synthesis from memory plus provider failures when the request requires current
  public facts;
- source panels that display weak terminal states such as `no_current_event_facts` as if they were
  checked positive evidence;
- fallback cards from generic Places results when the selected entities did not come from research
  or another domain-specific tool.

The failure mode to avoid is:

```text
research needed
  -> research unavailable or skipped
  -> broad Places lookup or weather lookup
  -> plausible but weak answer
```

The required behavior is:

```text
research needed
  -> research succeeds
  -> answer from ranked findings
```

or:

```text
research needed
  -> research unavailable or insufficient
  -> say the current public evidence could not be verified
  -> optionally offer stable baseline context clearly labeled as unverified
  -> do not show generic Places cards as the answer
```

This means provider failure should degrade to a transparent caveat, not to the old answer strategy.
The model should never be allowed to silently substitute broad Places, memory, or weather for
required web research.

### Add A General Research Tool

Add a model-callable tool named `research_web`.

Files to change:

- `src/server/chat/agent-runtime.ts`: add `"research_web"` to `AskSiargaoAgentToolName`.
- `src/server/chat/agent-tools.ts`: register the Responses tool, validate arguments, execute the
  research pipeline, and return structured `AgentToolResult`.
- `src/server/chat/agent-tools.test.ts`: cover strict schema shape, successful evidence, source
  labels, provider failures, and restricted output.
- `src/server/chat/source-consistency.ts`: allow new source labels only when backed by
  `research_web` tool output.
- `src/server/chat/answer-source-summary.ts`: add any new trust labels needed for public web
  evidence.
- `src/server/trips/shared-trip-types.ts` and `src/server/chat/condition-tools.ts`: mirror new
  source labels in Zod schemas if they can appear in saved or condition artifacts.

Suggested tool arguments:

```ts
type ResearchWebArguments = {
  query: string;
  intent: "recommendation" | "schedule" | "availability" | "price" | "safety" | "how_to" | "fact";
  location?: string;
  dateContext?: "today" | "tonight" | "tomorrow" | "next_7_days" | "date_range" | "none";
  sourceTypes?: Array<
    | "official"
    | "government"
    | "local_directory"
    | "maps"
    | "guide"
    | "social"
    | "community"
    | "news"
    | "weather"
  >;
  requiredFreshness?: "live" | "same_day" | "week" | "month" | "stable";
  maxSources?: number;
};
```

Suggested result data:

```ts
type ResearchWebResultData = {
  status: "available" | "insufficient" | "provider_unavailable";
  normalizedQuery: string;
  searchedQueries: string[];
  findings: ResearchFinding[];
  entities: ResearchEntity[];
  sourceScores: ResearchSourceScore[];
  notChecked: string[];
};

type ResearchFinding = {
  claim: string;
  answerRole: "primary" | "supporting" | "negative" | "caveat";
  confidence: "high" | "medium" | "low";
  sourceUrl: string;
  sourceTitle: string;
  sourceType: string;
  publishedOrUpdatedAt?: string;
  matchedDateContext?: string;
};

type ResearchEntity = {
  name: string;
  kind: "place" | "operator" | "event" | "route" | "service" | "activity";
  role?: string;
  area?: string;
  needsPlacesEnrichment?: boolean;
};
```

The tool should return evidence and entities, not final prose. The model still writes the final
answer from tool output.

Implementation note: the first production adapter is `src/server/providers/web-search.ts`, enabled
only when `WEB_RESEARCH_PROVIDER=openai` and `WEB_RESEARCH_SECURITY_BOUNDARY_COMPLETE=true` are
configured. It uses the OpenAI Responses hosted `web_search` tool to return structured source
summaries that are then scored by `src/server/chat/web-research.ts`.

Every hosted-search page is an untrusted input. The extraction prompt explicitly rejects webpage
instructions, the adapter accepts only bounded HTTP(S) URLs and bounded normalized text fields,
and the answer model receives web findings only inside a JSON `untrustedWebEvidence` object marked
`untrusted_external_data`. Higher-priority agent instructions prohibit following role changes,
commands, secret requests, or tool directives found anywhere in that object. Provider and agent-loop
tests use adversarial source titles, summaries, claims, and JSON-shaped injection strings to verify
that attacker-controlled fields cannot become trusted top-level instructions.

### Add A Research Planner

Add deterministic planning before the model freely chooses tools.

Files to change:

- `src/app/api/chat/chat-route.ts`: derive broad `researchIntent` signals from the latest user turn
  and trip context.
- `src/server/chat/required-evidence.ts`: add required `research_web` calls for requests that need
  current public information.
- `src/server/chat/ask-siargao-agent.ts`: preflight required research calls before downstream
  enrichment tools when the plan requires it.
- `src/server/chat/ask-siargao-agent.test.ts`: add ordering tests that fail if Places/weather run
  before required research for current recommendation prompts.

The planner should trigger on more than nightlife:

- current recommendations: "best", "where should I go", "what should we do tonight", "any good";
- schedules: "today", "tonight", "tomorrow", dates, weekdays, ferry times, events;
- availability-like requests: "open", "running", "still happening", "closed", "cancelled";
- prices and offers: "how much", "promo", "current rate", "tour price";
- safety and disruption: road closures, storm impacts, brownouts, advisories;
- comparison requests where current public reputation matters.

The planner should not trigger research for stable local facts already covered by curated memory or
local guide tools unless the user asks for current status.

### Add Search And Fetch Providers

Create provider modules for public web discovery.

Suggested files:

- `src/server/providers/web-search.ts`: search API adapter. This can wrap an external search API or
  a hosted model web-search tool, but expose a repo-owned interface.
- `src/server/providers/web-page-fetch.ts`: fetch selected pages with timeout, size limits, content
  type checks, robots/source policy checks where applicable, and text extraction.
- `src/server/providers/web-research-store.ts`: optional cache for search results, fetched page
  summaries, normalized findings, TTLs, and attribution.
- `src/server/chat/web-research.ts`: domain-neutral query expansion, source scoring, extraction
  normalization, and result shaping for the `research_web` tool.
- `src/server/chat/web-research.test.ts`: unit tests for query planning, source scoring,
  extraction safety, freshness rules, and negative evidence.

Do not wire the model directly to unrestricted raw web pages. The tool should normalize and bound
what enters the model context.

### Add Source Classes And Scoring

`research_web` should score sources by the user need, not by one global ranking.

General scoring dimensions:

| Dimension | Meaning |
| --- | --- |
| Authority | Official venue/operator/government pages outrank blogs and community posts for factual status. |
| Freshness | Same-day and dated pages outrank stale pages for current requests. |
| Exactness | Exact location, entity, date, weekday, and activity matches outrank broad guides. |
| Corroboration | Multiple independent sources increase confidence. |
| Negative evidence | Closed, cancelled, inactive, or not-running evidence must be preserved. |
| Source fit | Google Places is good for map/hours metadata, not event ranking or editorial judgment. |

Suggested source classes:

- `official`: venue, operator, event organizer, ferry company, resort, tour operator;
- `government`: tourism, municipal, port, weather/safety agencies;
- `local_directory`: Siargao directories, event calendars, local business listings;
- `maps`: Google Places or equivalent venue metadata;
- `guide`: travel blogs and recent guide articles;
- `social`: public Instagram/Facebook/TikTok pages or posts, if provider policy allows;
- `community`: Reddit and public forums;
- `weather`: weather, marine, tide, and warning APIs;
- `news`: local or national reporting.

For each request type, define source priority. Examples:

| Request type | Primary sources | Supporting sources | Enrichment |
| --- | --- | --- | --- |
| Party/event tonight | official, local_directory, social | guide, community | Places, weather |
| Restaurant now | Places, official, local_directory | guide, social | weather only if outdoor/rain-sensitive |
| Ferry or transport | official, government, operator | news, community | weather/marine for disruption context |
| Tour price | official, operator, local_directory | guide | Places for location/contact |
| Safety/disruption | government, news, weather | community | local memory for interpretation |
| Stable beach recommendation | local guide, memory | guide, community | weather/marine/tide if date-sensitive |

### Change Required Evidence Ordering

`research_web` must be able to run before existing tools.

Current code already has required evidence ordering logic in `src/server/chat/ask-siargao-agent.ts`
and `src/server/chat/required-evidence.ts`. Extend it so plans can express dependency order:

```ts
type RequiredEvidenceToolCallBase = {
  name: AskSiargaoAgentToolName;
  purpose: string;
  arguments: Record<string, unknown>;
  acceptedSourceLabels: readonly string[];
  terminalSourceLabels: readonly string[];
  dependsOn?: string[];
};
```

Example for a current recommendation:

```text
research_web
  -> search_places for selected place entities only
  -> get_weather_forecast when the final route is weather-sensitive
```

This prevents broad fallback calls like `party bars nightlife General Luna Siargao` from running
before the system knows which entities are actually relevant.

When a plan declares `research_web` as required, `missingRequiredEvidenceToolCalls` and the
tool-loop repair path should treat it as a hard gate. Downstream tools can run only when research
returns selected entities or the downstream tool is independently required by the user request. A
failed or insufficient research result must not unlock legacy broad Places enrichment.

### Turn Places Into Enrichment

Google Places should not rank every current local recommendation by itself.

Files to change:

- `src/server/chat/required-evidence.ts`: when `research_web` returns selected entities, build
  Places calls for those names instead of category-wide searches.
- `src/server/chat/ask-siargao-agent.ts`: repair model-selected Places calls so broad category
  searches are replaced by entity-specific enrichment when research results exist.
- `src/server/chat/agent-runtime.ts`: keep place cards, but expose only cards selected by the final
  payload and allowed by required evidence.

Bad pattern:

```text
search_places("party bars nightlife General Luna Siargao")
```

Better pattern:

```text
research_web("best party locations General Luna tonight")
  -> findings: Goodies, Mama Coco, El Lobo, Siargao Beach Club
search_places("Goodies Siargao")
search_places("Mama Coco Siargao")
search_places("El Lobo Siargao")
```

After this change, broad category Places search should remain valid only for stable place-discovery
questions where Places is the right primary source, such as "pharmacy near me", "coffee open now",
or "restaurants near Cloud 9." It should not be the fallback for current editorial recommendations,
events, schedules, prices, disruptions, or "best tonight" prompts.

### Add Source Labels For Web Research

The current labels distinguish Places, weather, curated guide, community, event, and provider
failure. Add labels that can represent general web research without overclaiming.

Suggested labels:

- `web_researched`: useful public web evidence from source classes accepted for the request;
- `official_checked`: official public source checked for the requested entity/status;
- `directory_checked`: local directory or event-calendar source checked;
- `community_signal`: keep as low-confidence support only;
- `not_verified`: generic reasoning or memory interpretation;
- `provider_unavailable`: search/fetch provider failure;
- `insufficient_web_evidence`: search ran but did not find enough reliable evidence.

Avoid using `live_checked` for web pages. Keep `live_checked` scoped to live provider APIs such as
Google Places unless the source policy is explicitly changed.

Files to change:

- `src/server/chat/answer-source-summary.ts`;
- `src/server/chat/source-consistency.ts`;
- `src/server/chat/source-consistency.test.ts`;
- `src/server/chat/agent-tools.ts` `describe_source_policy`;
- `src/server/chat/agent-tools.test.ts`;
- DTO schemas that persist or display source summaries.

### Store Normalized Research Evidence

Use a short-lived cache for web search and extracted findings. Do not store arbitrary raw web pages
as product truth.

Current implementation decision: persistence is deferred. The first provider path passes normalized
source summaries directly into the tool loop and does not durably store raw pages, raw Responses
payloads, private/social content, or unrestricted web summaries. Add the storage below only when
cost, latency, replay/debugging, or governed attribution reuse creates a real product need.

Suggested storage:

```text
web_research_runs
  id
  request_id
  normalized_query
  intent
  location
  date_context
  status
  searched_at
  expires_at

web_research_sources
  id
  run_id
  url
  title
  source_type
  fetched_at
  published_or_updated_at
  score
  allowed_use
  attribution_json

web_research_findings
  id
  run_id
  source_id
  claim
  entity_name
  answer_role
  confidence
  matched_date_context
```

If the repo keeps using Drizzle migrations, add schema under `src/server/db` and migrations under
`drizzle/`. Follow existing provider retention patterns and add pruning if raw summaries or fetched
content are stored.

### Update Agent Memory To Guide Research

Memory should become a search strategy guide, not a substitute for web research.

Files to change:

- `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md`: define when `research_web` is required and
  how it composes with Places, weather, local guides, and memory.
- `docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md`: define source classes, labels, and
  overclaiming rules.
- `docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md`: add answer shapes for research-backed ranked
  recommendations.
- Domain files such as `docs/agent-memory/NIGHTLIFE.md` and `docs/agent-memory/SURF.md`: add query
  templates and source-priority hints, not hardcoded answer patches.
- `docs/agent-memory/INDEX.md`: add trigger terms for general web research.

Example memory guidance:

```text
For current recommendations, use research_web before Places unless a more specific governed tool
already returns fresh evidence. Use Places only to enrich selected entities with map/opening data.
```

## How The Runtime Should Decide Sources

The model should not scrape arbitrary pages directly. The runtime should expose a bounded research
tool that lets the model request research while deterministic code controls source selection,
fetching, scoring, and output.

Decision sequence:

1. `chat-route.ts` derives intent and research need.
2. `required-evidence.ts` creates a research plan when current public information is needed.
3. `ask-siargao-agent.ts` executes required research before dependent tools.
4. `research_web` expands the query into targeted searches.
5. Provider adapters search and fetch bounded pages.
6. `web-research.ts` scores sources and extracts findings.
7. Existing tools enrich selected entities when needed.
8. The model writes a ranked answer from structured findings.
9. Source consistency validates every public source label against audited tool output.

## Query Planning

The research tool should generate multiple targeted queries per request.

For a current local recommendation:

```text
<topic> <location> <date or weekday>
<topic> <location> official
<known entity> <date or weekday> schedule
<topic> <location> latest guide
<topic> <location> reddit
<entity> closed cancelled <date or weekday>
```

For a ferry or transport request:

```text
<route> ferry schedule official
<operator> <route> schedule
<port> advisory <date>
<route> weather cancellation
```

For a restaurant request:

```text
<cuisine or need> <location>
<venue> official hours
<venue> menu price
<location> best <need> recent
```

The tool should dedupe search results by canonical URL, prefer exact matches, and stop early when
high-confidence sources answer the request.

## Answer Shaping

Research-backed answers should lead with the answer, then source confidence.

Good pattern:

```text
For tonight, I would rank it:

1. Goodies, 8 PM-midnight - official/local event source supports Funky Wednesday.
2. Mama Coco, 9 PM+ - directory-backed Wednesday reggaeton/Afro/dancehall pattern.
3. El Lobo, 8 PM+ - lower-confidence guide/community fallback.

Route: Mama Coco or Sibol warm-up -> Goodies main party -> El Lobo if Goodies is quiet.

Not a move tonight: Barbosa, because the official schedule says Wednesday is closed.
```

Bad pattern:

```text
The weather is rough. If you want, I can give you a route.
```

Weather, Places, and caveats should modify the answer, not replace it, unless the user asked only
about those conditions.

## Tests

Add tests at four levels.

### Tool Tests

Files:

- `src/server/chat/web-research.test.ts`;
- `src/server/chat/agent-tools.test.ts`.

Cover:

- query expansion for current, schedule, price, safety, and stable recommendation prompts;
- source scoring by authority, freshness, exactness, and negative evidence;
- provider failure returns `provider_unavailable`;
- weak search returns `insufficient_web_evidence`;
- raw fetched text, restricted payloads, and secrets are not returned to the model.

### Runtime Ordering Tests

File:

- `src/server/chat/ask-siargao-agent.test.ts`.

Cover:

- `research_web` runs before Places for current recommendation prompts;
- Places searches are entity-specific after research;
- broad Places category searches are repaired or skipped when research is required;
- broad Places category searches are not accepted as fallback after research failure;
- weather cannot dominate a recommendation answer when research found relevant entities;
- weather-only answers are rejected for non-weather recommendation prompts;
- memory-only baseline answers are rejected for current prompts unless explicitly caveated after
  research failure;
- final payload must mention primary research findings before accepted.

### Intent Tests

Files:

- `src/app/api/chat/route.test.ts`;
- `src/server/chat/required-evidence.test.ts` if added.

Cover:

- general current/recommendation prompts trigger research, not only nightlife;
- stable beach/local-guide prompts do not require web research unless date-sensitive;
- ferry, tour price, closure, and event prompts do require research.

### Source Consistency Tests

File:

- `src/server/chat/source-consistency.test.ts`.

Cover:

- public web labels require successful `research_web` output;
- memory and model reasoning cannot back web research labels;
- community evidence cannot become official/source-of-truth evidence;
- rendered source lines and structured sources are both validated.

## Rollout Plan

1. Add type and schema support for research source labels.
2. Implement `research_web` with mocked providers and deterministic tests.
3. Add a provider adapter behind environment variables.
4. Add required-evidence planning for broad current/recommendation requests.
5. Remove or gate legacy broad Places-first paths for request classes now covered by research.
6. Convert Places to enrichment after research-selected entities.
7. Add answer repair for research-backed recommendations that omit primary findings.
8. Add explicit failure behavior for unavailable or insufficient research that does not fall back to
   Places/weather/memory as the answer.
9. Add persistence/caching if provider cost or latency requires it.
10. Update agent memory source/tool policies.
11. Run focused tests, full `bun test`, typecheck, lint, and build.

## Open Decisions

- Whether to add a second web search provider after the first OpenAI hosted `web_search` adapter.
- Whether public social pages are fetched directly, searched only by snippets, or excluded until a
  source policy is written.
- Whether normalized web research evidence needs short-lived persistence; raw fetched page text
  remains out of durable storage unless source policy explicitly allows it.
- How much web research budget an anonymous request gets versus an authenticated trip pass.
- Whether `research_web` should be one tool or split into `plan_web_research`, `search_web`, and
  `fetch_web_sources` for deeper auditability.

## Success Criteria

- For current recommendation prompts, the first answer is a ranked synthesis from relevant public
  sources, not a Places list or weather caveat.
- If research is required and unavailable, the answer says current evidence could not be verified
  instead of falling back to broad Places, memory, or weather as the answer.
- Places cards, when shown, correspond to entities selected by research.
- The answer includes negative evidence when it matters, such as closed/cancelled/not-running.
- Source labels distinguish official, directory, community, Places, weather, memory, and weak
  evidence.
- Source-consistency validation can prove that every displayed source label came from the matching
  audited tool.
- The same mechanism works for nightlife, food, ferries, tours, safety, events, and other current
  Siargao requests.
