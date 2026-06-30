# 007 - Add Nightlife Event Sources And Route-Style Answers

Status: draft  
Priority: P0  
Effort: medium-large  
Risk: medium  
Depends on: existing chat agent tools, source registry, Google Places chat adapter  
Category: product quality, source governance, local recommendations  
Planned at: `2026-06-30`

## Goal

Make Ask Siargao better than generic ChatGPT for Siargao nightlife questions by answering the
actual traveler job: "where should I go tonight, in what order, and why?"

The current app can return Google Places bar listings with open-now status. That is useful
supporting evidence, but it does not answer time-bound nightlife questions such as:

- "What are the best party places in General Luna tonight?"
- "Where is the main party on Tuesday?"
- "Where should I go after dinner for drinks?"
- "Is there live music or a DJ tonight?"
- "What is the best bar-hopping route near Tourism Road?"

The product should return a source-backed timed route: warm-up, main party, late option, softer
alternative, and transport/weather caveats.

## Problem Evidence

Observed query:

```text
What are the best party places in general luna tonight?
```

Current Ask Siargao behavior:

- classified the request as a bar/place lookup rather than a nightlife event plan;
- treated `tonight` weakly and did not plan for evening time windows;
- called only Google Places with a `bar` type and `open_now`;
- returned venues such as Hideaway, Fayeyeh Bar, POP UP BAR SIARGAO, Mad Monkey, BARREL, and
  Lagkaw Beach Bar;
- displayed "Open now according to Google Places" and "Live checked".

Better target behavior:

- identify the day/date and relevant evening windows;
- check recurring and date-specific nightlife events;
- use Google Places only to enrich venue identity, address, maps, rating, and opening-hour signals;
- produce a route such as `BARREL 7-9 PM -> Barbosa 9 PM-late -> Siargao Beach Club after 11 PM`
  when the evidence supports it;
- state what was checked and what remains unverified.

## Product Principle

Ask Siargao should not be a narrower clone of ChatGPT. It should be a local operating system for
Siargao travel decisions.

For nightlife, the winning claim is:

```text
Ask Siargao knows tonight's Siargao move, not just which bars exist on Google Maps.
```

## In Scope

- New nightlife-specific intent classification.
- New event and recurring-schedule data model.
- New source profiles for allowed nightlife/event sources.
- New provider or local-data tool for nightlife event lookup.
- Route-style answer formatting for nightlife questions.
- Source labels and confidence wording that distinguish events, venues, weather, and unchecked
  crowd signals.
- Regression tests for the General Luna party query.

## Out of Scope

- Scraping private Facebook groups or private social content.
- Storing raw Instagram, Facebook, Reddit, or Google payloads indefinitely.
- Rebuilding a full web search engine.
- Booking, ticketing, table reservations, guest list management, or payments.
- Guaranteeing live crowd size, door policy, table availability, or last-minute cancellation status.

## Feature Requirements

### 1. Nightlife Intent

Add a specific intent, tentatively named `nightlifeEventPlan`.

Trigger terms should include:

- `party`, `parties`, `nightlife`, `bar hopping`, `go out`, `drinks tonight`;
- `DJ`, `live music`, `foam party`, `pub quiz`, `trivia`, `disco`, `latin night`;
- temporal terms such as `tonight`, `this evening`, `late`, `after dinner`, `after 11`.

`tonight` must be treated as a time-bound planning signal. It should imply:

- date resolution using the server/request timezone;
- evening and late-night windows, not current clock time;
- event occurrence lookup before generic place lookup;
- weather check when the route requires moving between venues.

Implementation touchpoints likely include:

- `src/app/api/chat/chat-route.ts`
- `src/server/chat/intent.ts`
- `src/server/chat/place-intent.ts`
- `src/server/chat/required-evidence.ts`
- `src/server/chat/ask-siargao-agent.ts`
- `src/server/chat/agent-tools.ts`

### 2. Nightlife Event Fact Model

Represent nightlife as events and occurrences, not just places.

Minimum entity types:

- `venue`: a physical place, usually backed by Google Places or curated identity.
- `event_series`: a recurring event concept, for example `Disco Tropico`.
- `event_occurrence`: a specific occurrence on a date or weekday.

Minimum fields for an event occurrence:

```ts
type NightlifeEventOccurrence = {
  id: string;
  venueId: string;
  eventSeriesId?: string;
  name: string;
  date?: string;
  dayOfWeek?: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
  startTimeLocal?: string;
  endTimeLocal?: string;
  timeLabel: string;
  area: "General Luna" | "Cloud 9" | "Malinao" | "Siargao Island";
  intensity: "chill" | "social" | "party" | "late_party";
  bestFor: string[];
  caveats: string[];
  sourceProfileId: string;
  sourceUrl?: string;
  observedAt: string;
  expiresAt: string;
  confidence: "low" | "medium" | "high";
};
```

Reuse the existing fact graph where possible:

- fact type: `event_occurrence`;
- freshness: expires after event end;
- reuse scope: `global` for allowed manually curated facts, `citation_only` for source-derived facts
  when permitted, `internal_only` for weak social chatter.

### 3. Source Profiles

Do not let the model browse arbitrary social media directly. Add explicit source profiles and a
source policy for each class.

Initial source classes:

| Source class | Examples | Access method | Allowed use | Confidence |
| --- | --- | --- | --- | --- |
| Official venue website | Barbosa schedule page | `official_page` | citation or public republish if allowed | high |
| Local event directory | SiargaoVibes event pages | `crawl` or partner/API later | citation-only by default | medium |
| Venue-submitted event | admin form, partner dashboard | `partner` or `user_submitted` | public republish with terms | high |
| Public social page | official Instagram/Facebook page snippets or links | `official_page` where allowed | citation-only or metadata-only | low-medium |
| Community chatter | Reddit public posts/comments | `crawl` or API where allowed | internal signal, cite sparingly | low |
| Google Places | Google Places API | `api` | existing citation-only policy | medium for venue identity, low for event quality |

Private or semi-private Facebook groups must be disallowed unless content is explicitly submitted
by a user, venue, or partner with permission.

Implementation touchpoints likely include:

- `src/server/providers/source-registry.ts`
- `src/server/providers/adapters.ts`
- database seed for `source_profiles`
- source-policy tests

### 3a. Online Sources To Query For Freshness

Nightlife freshness should come from a small ordered source set. The agent should not "search the
web" generically and hope the model sorts it out; the backend should query approved sources by
priority, normalize event facts, and expire those facts aggressively.

For General Luna nightlife, use this query order:

| Priority | Source | Example URLs from current research | Query purpose | Freshness window | Storage and answer policy |
| ---: | --- | --- | --- | --- | --- |
| 1 | Official venue website | `https://www.barbosasiargao.com/schedule-1` | Canonical recurring schedule, closed days, official event names, opening windows | 7 days for recurring weekly schedule; same-day refresh when answering `tonight` | Store extracted facts only; cite URL; high confidence when page is official and current |
| 2 | Official multi-venue event page | `https://happinessphilippines.com/upcoming-event/` | Official Happiness/Goodies/Happiness Beach Bar weekly events and time windows | 7 days for recurring schedule; same-day refresh when answering `tonight` | Store extracted facts only; high confidence for Happiness-owned venues |
| 3 | Local event directory | `https://siargaovibes.com/activities/tuesdays-pub-quiz-at-barrel/`, `https://siargaovibes.com/nightlife/mama-coco-siargao-events-schedule/`, `https://siargaovibes.com/nightlife/thursdays-at-bed-brew/`, `https://siargaovibes.com/nightlife/saturdays-at-harana/` | Date-specific event occurrences, upcoming dates, time ranges, venue links | Event occurrence expires after end time; recurring page recheck daily for `tonight`, weekly otherwise | Store event facts and source URL; citation-only unless permission allows republish |
| 4 | Official venue Instagram profile or post | `https://www.instagram.com/barbosa_siargao/`, `https://www.instagram.com/barrelsiargao/`, `https://www.instagram.com/siargaobeachclubph/`, `https://www.instagram.com/sibol.siargao/` | Last-minute event confirmation, weekly flyer, special guest DJ, cancellation, time changes | Same-day for `tonight`; 24 hours for tomorrow/this week; post-level facts expire after event | Store metadata/extracted facts only; do not store raw media or captions beyond allowed short snippets; cite official page/post when allowed |
| 5 | Official venue Facebook page or public post | `https://www.facebook.com/siargaobeachclubph/`, `https://www.facebook.com/sibol.siargao/`, public Siargao Beach Club foam-party posts | Public venue hours, recurring foam-party timing, last-minute operational updates | Same-day for `tonight`; 24 hours for active public posts; 7 days for stable hours | Use only public official pages/posts; store extracted facts; never ingest private groups without explicit permission |
| 6 | Local guide or directory page | `https://www.siargaolocal.com/business/sibol-siargao/` | Stable venue characterization such as live music, vibe, service caveats, best-fit use | 30 days for venue/vibe facts; not sufficient for a specific event tonight | Store derived venue-fit facts; cite as guide source; medium confidence |
| 7 | Travel/news article | `https://www.philstar.com/lifestyle/travel-and-tourism/2025/02/28/2424858/free-foam-party-you-can-enjoy-siargao` | Background confirmation for recurring patterns such as Tuesday/Saturday foam party | 30-90 days for background pattern; must be checked against fresher sources for `tonight` | Use as corroboration, not primary same-day truth; cite when mentioned |
| 8 | Review/travel platforms | TripAdvisor pages for BARREL, Siargao Beach Club, Sibol; Wanderlog pages for Barbosa/SBC/Sibol | Venue quality, atmosphere, crowd/vibe, historical event mentions | 14-30 days for vibe/review signal; never primary for event occurrence | Store only allowed derived signals; do not republish review text unless source terms allow |
| 9 | Reddit public threads | `https://www.reddit.com/r/SiargaoPH/comments/1j6e8nd/nightlife_party_schedule/` | Community party-rhythm signal and "where people actually go" hints | 30 days for broad party rhythm; stale immediately for tonight-specific claims unless newly posted | Low confidence; use as community context; never override official/event sources |
| 10 | YouTube nightlife videos | Recent General Luna nightlife videos | Visual evidence of active nightlife zones, crowd style, route geography | 30-90 days for atmosphere only; not valid for tonight's schedule | Optional research signal; do not treat as event proof |
| 11 | Broad travel blogs | Diwa Siargao nightlife schedule, smallgirlbigbackpack nightlife guide, other dated guides | Candidate source discovery and historical weekly schedule | 30-90 days for background; lower confidence than current venue/event pages | Use for discovery and fallback context; verify against priorities 1-5 before answering `tonight` |
| 12 | Google Places | Existing Google Places API | Venue identity, map link, address, rating/review count, business/opening-hour status | Existing 7-day venue freshness; live call when map/open status is needed | Venue enrichment only; not event truth and not nightlife ranking |
| 13 | Open-Meteo weather | Existing weather provider | Late-night rain/storm/wind context for route movement | 1-3 hours for same-day planning | Weather caveat only; not nightlife ranking |

Required same-day strategy for `tonight`:

1. Resolve local date and weekday in the Siargao timezone.
2. Query fresh event occurrences from local cache.
3. If fewer than two high/medium-confidence event-backed options exist, refresh priorities 1-5.
4. Use priorities 6-11 only to fill vibe, intensity, and fallback context.
5. Enrich selected venues with Google Places for map/open/status details.
6. Check weather if the answer recommends moving between venues.
7. Mark any unverified fields explicitly: live crowd size, door policy, guest list, table
   availability, last-minute cancellation, and exact closing time.

For the example query on Tuesday, June 30, 2026, the expected source-backed checks are:

- BARREL Tuesday pub quiz or trivia from SiargaoVibes and/or BARREL official social pages.
- Barbosa Disco Tropico from Barbosa's official schedule and SiargaoVibes.
- Mama Coco Latin Night from SiargaoVibes and/or official social pages.
- Siargao Beach Club Tuesday foam party from official Instagram/Facebook, plus Philstar as
  background corroboration.
- Sibol live music from Siargao Local and official Sibol social pages.
- Reddit only as a low-confidence community party-rhythm cross-check.
- Google Places only for maps, address, business status, ratings, and open-hour signals.

### 3b. Weekly Baseline To Seed

As of June 30, 2026, seed the following weekly baseline with per-row confidence
and source caveats. This baseline is not same-day truth; the event lookup must
still refresh the relevant day for `tonight`.

| Day | Warm-up | Main window | Candidate anchors | Source posture |
| --- | --- | --- | --- | --- |
| Monday | 5:30 PM+ / 6 PM+ | 8 PM-late | Barbosa Golden Hour, Mama Coco Retro Night, El Lobo | Barbosa official high; Mama Coco directory medium; El Lobo guide/community low until official page confirms. |
| Tuesday | 7-9 PM | 9 PM-late | BARREL Pub Quiz, Barbosa Disco Tropico, Mama Coco Latin Night, Siargao Beach Club | Strongest checked route: BARREL -> Barbosa -> Siargao Beach Club if needed; Mama Coco is an alternate party option. |
| Wednesday | 7:30-9 PM | 8 PM-midnight / 9 PM+ | Goodies, Mama Coco, El Lobo | Goodies official Happiness high; Mama Coco directory medium; El Lobo low until official confirmation. |
| Thursday | 5:30 PM+ / 8 PM | 8 PM-late | Bed & Brew, Barbosa Odd Ball | Bed & Brew directory medium; Barbosa official high. |
| Friday | 5:30 PM+ / 6 PM+ | 8-9 PM-late | Barbosa, Mama Coco, El Lobo, Siargao Beach Club | Barbosa official high; Mama Coco directory medium; El Lobo/SBC need day-of social confirmation. |
| Saturday | 6 PM+ | 9 PM-1 AM | Harana Surf Resort, late Siargao Beach Club | Harana listing says every Saturday but displayed event date is old; require official social confirmation. |
| Sunday | 6 PM | 6 PM-midnight | Happiness Beach Bar / Sunday Fun Day | Happiness official high. |
| Every night | 4-6 PM happy hour | 9 PM-2 AM | Sibol, Siargao Beach Club | Fallback/after-party context only; requires current confirmation. |

### 4. Nightlife Event Lookup Tool

Add a backend tool, tentatively named `search_nightlife_events`.

Tool input:

```ts
type SearchNightlifeEventsInput = {
  date: string;
  location?: "General Luna" | "Cloud 9" | "Siargao Island";
  timeWindow?: "early_evening" | "main_party" | "late_night" | "any";
  vibe?: "chill" | "social" | "party" | "live_music" | "solo_friendly";
  includeRecurring?: boolean;
  includeDateSpecific?: boolean;
};
```

Tool output:

```ts
type SearchNightlifeEventsOutput = {
  text: string;
  events: NightlifeEventOccurrence[];
  venueIdsForPlacesEnrichment: string[];
  sources: AnswerSourceSummary[];
  notChecked: string[];
};
```

The tool should:

- query curated recurring events first;
- query fresh event facts for the requested date;
- optionally call approved source adapters when cached facts are missing or stale;
- return event occurrences, not final prose;
- include source summaries with checked/not-checked boundaries.

### 5. Google Places Enrichment

After event lookup, call existing Google Places tools for venue enrichment only when needed.

Use Google Places for:

- map link;
- formatted address;
- business status;
- current or requested-time opening-hour signal when available;
- rating and review count.

Do not use Google Places relevance ordering as the nightlife ranking.

For "tonight" questions, avoid saying only "open now" unless the user asks what is open at the
current moment. Prefer wording such as:

```text
Venue details checked with Google Places. Tonight's event schedule came from local event sources.
Opening hours can change, so confirm before going late.
```

### 6. Weather And Transport Context

Nightlife route answers should check weather when:

- the user says `tonight`;
- the route moves between venues;
- rain, wind, storm, or scooter/tricycle decisions matter.

Answer should include one practical transport line when relevant:

```text
If you plan to drink or move venues late, use a tricycle rather than a scooter.
```

Do not overdo weather unless it changes the decision.

### 7. Route-Style Answer Format

Nightlife answers should default to a sequence, not a directory.

Recommended final shape:

```text
Tonight's strongest route in General Luna:

1. Warm-up: BARREL, 7-9 PM
2. Main party: Barbosa, from 9 PM
3. Late option: Siargao Beach Club, around 11 PM onward
4. Softer option: Sibol, from 7 PM

My pick: BARREL -> Barbosa -> Siargao Beach Club if you still want more.

Checked: event schedule sources, Google Places venue details, weather forecast.
Not checked: live crowd size, door policy, last-minute cancellations.
```

Cards should still show venue details, but the main answer should be the move.

### 8. Source Labels And Confidence

Add or reuse source labels that make the boundary clear.

Suggested labels:

- `event_checked`: approved event source or manually verified event occurrence.
- `venue_checked`: Google Places or curated venue identity.
- `weather_checked`: existing Open-Meteo weather.
- `community_signal`: low-confidence social or Reddit signal.
- `not_verified`: generic reasoning or missing live confirmation.

Avoid using generic "Live checked" for the whole answer when only Google Places venue fields were
checked.

### 9. Agent Memory Knowledge Files

Stable nightlife knowledge should live in `docs/agent-memory` as Markdown, the same way surf,
beach, source-policy, and tool-use knowledge are handled today.

Add a new reference memory file:

```text
docs/agent-memory/NIGHTLIFE.md
```

This file should contain stable local-reference knowledge, not unbounded raw provider content.

It should include:

- the General Luna nightlife mental model: warm-up, main party, late option, softer/live-music
  alternative;
- known nightlife areas such as Tourism Road, Boardwalk, Cloud 9/Catangnan, and beachfront venues;
- recurring party-night candidates and their source URLs;
- venue-fit notes: solo-friendly, tourist-heavy, live music, sports bar, foam party, DJ/club night,
  date-friendly, chill drinks;
- source priority rules for nightlife, matching the freshness matrix above;
- caveats that event schedules change and last-minute confirmation needs live/source checks;
- answer-shape guidance for route-style nightlife responses;
- boundaries: memory is not live evidence, does not verify tonight's crowd, and does not replace
  `search_nightlife_events`, Google Places, or weather tools.

Do not put fragile same-day facts directly into `NIGHTLIFE.md` unless they are represented as
recurring patterns with a `last_verified` date and source URL. Specific event occurrences should
live in event facts with expiry.

Example structure:

```md
# Siargao Nightlife

## Loading Rules

Load this file for party, nightlife, bar-hopping, drinks tonight, DJ, live music,
foam party, pub quiz, trivia, late-night, and where-to-go-out prompts.

## Stable Planning Model

- Early warm-up: ...
- Main party: ...
- Late option: ...
- Softer option: ...

## Recurring Event Candidates

| Venue | Pattern | Source URL | Last verified | Confidence | Caveat |
| --- | --- | --- | --- | --- | --- |

## Source Priority

...
```

Wire the file into the runtime:

- update `docs/agent-memory/INDEX.md` with a `NIGHTLIFE.md` entry and loading rules;
- update `src/server/chat/agent-memory.ts` `requiredAgentMemoryManifest` with an
  `ask_siargao_nightlife` reference entry;
- include trigger terms such as `party`, `nightlife`, `bar hopping`, `drinks`, `DJ`, `live music`,
  `foam party`, `pub quiz`, `trivia`, `late night`, `tonight`;
- update agent-memory tests so the available-memory list includes `NIGHTLIFE.md`;
- update chat-route or agent tests so nightlife prompts call `load_agent_memory_file` for
  `NIGHTLIFE.md` before the final answer when the model needs local-reference context.

Runtime loading rule:

```text
INDEX.md is loaded by default.
For nightlife prompts, the model must load NIGHTLIFE.md plus ASK_SIARGAO_TOOL_USE_POLICY.md and
ASK_SIARGAO_SOURCE_POLICY.md when source/tool boundaries matter.
Then it must call search_nightlife_events for current events, Google Places for venue enrichment,
and weather for tonight route movement when relevant.
```

This keeps durable product knowledge in Markdown while preserving the separation between stable
local knowledge and live event evidence.

## MVP Data Seed

Create a small manually curated seed before building broad source ingestion.

Initial rows should cover common General Luna nightlife patterns:

- BARREL Tuesday pub quiz or trivia.
- Barbosa Tuesday Disco Tropico.
- Siargao Beach Club Tuesday/Saturday foam-party pattern if source-backed.
- Sibol nightly live music if source-backed.
- Mama Coco, Harana, Goodies, Bed and Brew, El Lobo, or other recurring nights only when verified.

Each seed row must include:

- source URL or manual verification note;
- last verified date;
- weekday/date;
- time label;
- confidence;
- expiry or review date.

## Technical Architecture

Preferred request flow:

```text
chat request
  -> interpretChatRequestIntent()
  -> nightlifeEventPlan = true
  -> required evidence planner requires search_nightlife_events
  -> search_nightlife_events checks event fact cache and allowed sources
  -> Google Places enriches selected venues
  -> weather tool checks tonight when route/weather matters
  -> agent writes route-style answer with exact source boundaries
  -> event facts and source observations are persisted with expiry
```

The LLM should receive bounded normalized context:

- event occurrence facts;
- venue cards;
- source summaries;
- not-checked gaps;
- weather summary when checked.

It should not receive unrestricted raw provider payloads or raw social-media bodies.

## Database Options

Short-term option:

- seed nightlife events as local facts if the existing fact schema can represent `event_occurrence`
  cleanly;
- keep implementation small and avoid new tables until the first version proves useful.

Longer-term option:

- add typed tables for `venues`, `event_series`, `event_occurrences`, and `event_source_observations`;
- sync selected facts back into the generic fact graph for answer-context reuse.

Recommended first implementation:

- use the existing fact/source system for MVP;
- add typed tables only if the local fact query layer becomes awkward or slow.

## Tests

Add regression coverage for:

- `tonight` sets a nightlife/time-bound intent.
- `party places in General Luna tonight` requires event evidence, not only Google Places.
- event lookup returns route candidates ordered by time and intensity.
- Google Places venue enrichment does not become the main ranking source.
- final answer does not claim event schedules were live checked when only venue details were checked.
- social/community sources cannot enter public answers without an explicit source profile and allowed
  use.
- event facts expire after the event.

Likely test files:

- `src/app/api/chat/route.test.ts`
- `src/server/chat/intent.test.ts`
- `src/server/chat/required-evidence.test.ts` if added
- `src/server/chat/agent-tools.test.ts`
- `src/server/providers/source-governance.test.ts`

## Validation

Run targeted checks after implementation:

```sh
bun test src/server/chat/intent.test.ts
bun test src/server/chat/agent-tools.test.ts
bun test src/app/api/chat/route.test.ts
bun run lint
bun run typecheck --incremental false
```

If database schema or seed data changes:

```sh
bun run db:migrate:test
bun run db:seed:test
```

## Done Criteria

- The General Luna party query returns a timed route, not just a Google Places bar list.
- The answer includes at least one event-backed recommendation when source data exists.
- Google Places is used as venue enrichment, not as the primary nightlife truth.
- The UI can display event cards or venue cards with clear source boundaries.
- Confidence wording distinguishes event schedule checks from venue/opening-hour checks.
- Social and web sources are governed by explicit source profiles.
- Tests prevent regression to a Google Places-only answer path.

## Product Metrics

Track:

- thumbs-up rate for nightlife answers;
- event-source coverage for nightlife queries;
- percentage of nightlife answers with at least one event-backed occurrence;
- provider calls per nightlife answer;
- answer latency;
- manual correction rate from ratings or admin review;
- saved/shared nightlife route rate.

Continue if:

- users prefer route-style nightlife answers over Google Places lists in at least 70% of comparisons;
- at least 80% of common General Luna nightlife queries return event-backed answers;
- source maintenance remains manageable with a small weekly review loop.

Kill or narrow if:

- event data cannot be maintained accurately;
- sources are too legally or technically brittle;
- users mostly ask generic venue questions rather than "what is happening tonight";
- answer latency or provider cost becomes unacceptable.

## Suggested Implementation Order

1. Add the nightlife intent and tests.
2. Add manually curated event seed data and event lookup tool.
3. Update required evidence planning for nightlife questions.
4. Add route-style final answer instructions and source labels.
5. Add Google Places venue enrichment after event lookup.
6. Add weather check for tonight route movement.
7. Add source profiles for approved event sources.
8. Add admin or seed workflow for maintaining recurring events.

## Suggested Commit

```text
Plan nightlife event source integration
```
