# Ask Siargao Better Answers Plan

Status: proposed implementation plan.

This plan translates the ChatGPT comparison into broad Ask Siargao product and code changes. The
Cloud 9 example is useful as a regression case, but it must not become the product strategy. The
real goal is stronger answers for any Siargao request: food, cafes, beaches, surf, weather,
transport, logistics, safety, accommodation context, open-ended plans, and follow-up questions.

The harness must stay thin. Deterministic code may classify, execute tools, validate evidence,
reconcile artifacts, and protect source policy, but the model must learn better traveler-facing
behavior from injected knowledge in `docs/agent-memory/`.

## Product Thesis

The proven base is ChatGPT-style natural-language help: travelers ask flexible questions because
they want a useful decision, not a database dump.

The better claim should be:

> Ask Siargao gives better Siargao answers than ChatGPT because it combines local curation, live
> provider checks, current conditions, saved trip context, source boundaries, and island-specific
> judgment for the exact request.

The new hook should be:

> Ask Siargao turns any local trip question into a checked next move, fallback, and reason.

This applies across request types:

- "Where should I eat near General Luna tonight?"
- "Is Malinao good for swimming today?"
- "Should I scooter to Pacifico in this rain?"
- "What time should I surf tomorrow?"
- "Which area should I stay in without a scooter?"
- "What should I do if island hopping is cancelled?"
- "Find a pharmacy or clinic nearby."
- "Review this itinerary and tell me what is unrealistic."

## Current Codebase Findings

- `src/server/chat/ask-siargao-agent.ts` already builds a thin tool-calling runtime. It injects
  memory metadata and `INDEX.md`, passes deterministic signals as hints, and requires final JSON
  selection of public artifacts.
- `src/server/chat/agent-runtime.ts` already supports model-selected cards, actions, and
  itineraries through `AgentFinalPayload.display*Ids`; unselected tool artifacts stay internal.
- `docs/agent-memory/INDEX.md` is already the only default domain memory file. This is the right
  place to route the model toward detailed answer-shape, local-assumption, tool-use, and
  source-policy files.
- `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md` has generic style guidance, but it does not yet
  define reusable answer patterns by request type.
- `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md` maps tools to evidence needs, but it should
  also teach the model how to combine tools into a request-specific evidence plan.
- `src/server/chat/itinerary-tools.ts` has useful planning themes, but answer-quality improvements
  cannot live only in itinerary themes. Many winning answers will be place, condition, transport,
  surf, or local-fact answers with no itinerary artifact.
- `src/features/chat/ChatWorkspace.tsx` can already render structured cards, source badges,
  itinerary cards, fallbacks, and skip guidance. The UI should grow small generic decision
  affordances instead of only improving one itinerary card.

## Non-Negotiable Harness Boundary

Do not solve this by expanding `askSiargaoBaseInstructions` into a large prompt.

Keep `src/server/chat/ask-siargao-agent.ts` limited to:

- loading the memory index and compact memory metadata;
- exposing governed tools;
- passing deterministic signals as evidence hints;
- repairing missing evidence for known risky request classes;
- parsing and validating final JSON;
- validating source and artifact contracts.

Put traveler-facing behavior guidance in:

- `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md`;
- `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md`;
- `docs/agent-memory/ASK_SIARGAO_LOCAL_ASSUMPTIONS.md`;
- optional new `docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md`.

If `ASK_SIARGAO_ANSWER_PATTERNS.md` is added, register it in
`src/server/chat/agent-memory.ts` and route it from `docs/agent-memory/INDEX.md`.

## Required Changes

### 1. Add Request-Type Answer Patterns To Agent Memory

Primary files:

- `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md`
- `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md`
- `docs/agent-memory/ASK_SIARGAO_LOCAL_ASSUMPTIONS.md`
- optional new `docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md`
- if new memory file: `docs/agent-memory/INDEX.md`
- if new memory file: `src/server/chat/agent-memory.ts`

Add model-facing answer patterns for the major request classes:

| Request class | Better answer shape |
| --- | --- |
| Place / food / cafe / bar / service | Best 1-3 options, why they fit, distance/area, open signal if checked, map cards, fallback if no live result. |
| Open-ended activity | Best next move, short sequence if useful, what to skip, weather/transport constraints, fallback. |
| Weather / condition / go-no-go | Clear judgment first, checked signals that matter, practical caution, safer alternative. |
| Surf / tide | Time window first, skill fit, tide/marine caveat, nearby alternatives when conditions are poor. |
| Beach / swimming | Fit for the intended use, surface/tide/current caveats, family/no-scooter constraints, alternatives. |
| Transport / logistics | Practical route or timing, uncertainty boundaries, what to book/check locally, avoid unrealistic detours. |
| Accommodation / area choice | Tradeoff by user constraint, area fit, transport implications, quiet/rain/no-scooter caveats. |
| Itinerary review | Find unrealistic legs, weather-sensitive risks, missing buffers, better sequence, kill weak stops. |
| Safety / medical / urgent local services | Direct local next step, live place/service lookup where possible, caution not to overclaim emergency status. |

Each pattern should teach the model to:

- answer the exact user request first;
- make a concrete local judgment, not a generic list;
- include the best next action;
- include a fallback or "skip this" only when it changes the decision;
- preserve user constraints such as area, time, transport, budget, kids, surfing ability, rain, and quiet;
- avoid internal terms such as artifact, required check, fallback promotion, tool, API, live checked, or not checked in the main answer.

### 2. Add A General Answer Quality Memory File

Primary files:

- `docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md`
- `docs/agent-memory/INDEX.md`
- `src/server/chat/agent-memory.ts`
- `src/server/chat/agent-memory.test.ts`

Create `ASK_SIARGAO_ANSWER_PATTERNS.md` if the answer-pattern guidance would make
`ASK_SIARGAO_AGENT_SKILLS.md` too large.

Suggested sections:

- `Direct Answer First`
- `Evidence Plan By Request Type`
- `Local Judgment`
- `Fallbacks And Skip Guidance`
- `Constraint Preservation`
- `When To Ask A Clarifying Question`
- `Bad Answer Smells`

Bad answer smells should include:

- generic tourist lists;
- exposing internal source/tool mechanics;
- giving a place card without explaining why it fits;
- giving weather without saying how it changes the plan;
- naming far-away options before nearby ones when the user asks for a local answer;
- turning every answer into an itinerary;
- burying the recommendation under caveats.

### 3. Broaden Required Evidence Planning

Primary files:

- `src/server/chat/required-evidence.ts`
- `src/server/chat/ask-siargao-agent.ts`
- `src/server/chat/agent-tools.ts`
- `src/server/chat/required-evidence.test.ts` if added
- `src/server/chat/ask-siargao-agent.test.ts`

Keep this as thin enforcement, not final-answer logic.

Extend required evidence rules by request class:

- place recommendations require `search_places` or `get_place_details`;
- current weather or condition-sensitive answers require `get_weather_forecast` or
  `get_condition_judgment`;
- surf timing requires `get_tide_forecast`, with `get_condition_judgment` only for go/no-go or
  safety-sensitive surf questions;
- swimming, boat trips, and exposed scooter rides require condition evidence when the question is
  go/no-go or safety-sensitive;
- itinerary requests require `plan_local_itinerary` only when the user asks for a sequence, route,
  half-day/day plan, crawl, or multiple-stop activity plan.

The point is to prevent unsupported claims while letting the model choose the final shape.

### 4. Add Generic Decision Metadata, Not Only Itinerary Metadata

Primary files:

- `src/server/chat/agent-runtime.ts`
- `src/server/chat/agent-tools.ts`
- `src/features/chat/ChatWorkspace.tsx`
- `src/features/trips/SharedTripPlanPage.tsx`
- `tests/e2e/chat.e2e.ts`

Add an optional structured decision artifact or small metadata fields that can support any answer,
not just itineraries.

Example shape:

```ts
export type DecisionSummary = {
  id: string;
  title: string;
  bestAction: string;
  basis: readonly string[];
  fallback?: string;
  avoid?: readonly string[];
  area?: string;
  timing?: string;
  sources: readonly AnswerSourceSummary[];
};
```

This should be optional and model-selected like cards and itineraries. It lets the UI show a compact
"best move / fallback / avoid" panel for place, weather, transport, beach, surf, and planning
answers without forcing every answer into an itinerary.

If this feels too broad for the first implementation, start by adding these fields to existing
cards and itineraries only:

```ts
decisionLabel?: "Best fit" | "Good now" | "Use as fallback" | "Avoid today" | "Needs confirmation";
bestAction?: string;
```

### 5. Generalize Ranking And Local Fit Rules

Primary files:

- `src/server/chat/itinerary-tools.ts`
- `src/server/chat/agent-tools.ts`
- `src/server/local/siargao-beaches.ts`
- `src/server/local/siargao-surf-spots.ts`
- `docs/agent-memory/ASK_SIARGAO_LOCAL_ASSUMPTIONS.md`
- `docs/agent-memory/LOCAL_GUIDE_BEACHES.md`
- `docs/agent-memory/SURF.md`

Improve local ranking rules across all request types:

- nearby means prioritize the named area or browser location before broader island options;
- open-now means prefer live place candidates with open status;
- rainy means prefer short transfers, covered/indoor options, and low-exposure plans;
- no scooter means avoid remote stops and surface tricycle/walkability caveats;
- with kids means avoid fragile ocean assumptions and prioritize simple logistics;
- surf ability should filter surf spots before recommending breaks;
- swimming should not inherit surf-spot logic;
- late-day answers should avoid long remote rides unless explicitly requested.

Cloud 9 should remain a regression example, not a special-case product principle.

### 6. Teach The Model To Add Something New

Primary files:

- `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md`
- optional `docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md`
- `src/features/chat/ChatWorkspace.tsx`

The "new" part versus ChatGPT should be visible in every answer where possible:

- a compact best-action panel;
- map cards for checked places;
- source/freshness badges without internal prose;
- saved recommendations or saved plan affordances;
- follow-up actions that continue the exact context;
- "avoid / fallback" guidance when local conditions make a common tourist answer weak.

This is not just for same-day planning. A restaurant answer can be new by showing open-now cards
and a context-preserving "find a backup nearby" action. A transport answer can be new by saving the
route assumption and offering a follow-up check. A surf answer can be new by pairing the time window
with skill-fit alternatives.

### 7. Tighten Public Answer Style Tests Across Request Classes

Primary files:

- `src/server/chat/ask-siargao-agent.test.ts`
- `src/server/chat/agent-runtime.test.ts`
- `src/server/chat/itinerary-tools.test.ts`
- `src/app/api/chat/route.test.ts`
- `tests/e2e/chat.e2e.ts`

Add regression tests for multiple representative prompts:

- food: "where should I eat near General Luna tonight?"
- cafe/service: "find a pharmacy near me that is open now"
- beach: "is Malinao good for swimming today?"
- surf: "what time should I surf tomorrow?"
- transport: "should I scooter to Pacifico today?"
- itinerary: "what should I do around General Luna this afternoon?"
- accommodation: "where should I stay without a scooter?"
- review: "review this itinerary and tell me what is unrealistic"

Assertions should check that:

- required evidence runs for the request class;
- final payload selects only relevant artifacts;
- answer text starts with a concrete judgment or best next action;
- constraints are preserved;
- internal words such as artifact, fallback promotion, not checked, tool, API, or required check do
  not appear in traveler-facing prose;
- UI cards or decision summaries make the next move clearer than prose alone.

## Suggested Implementation Order

1. Add or update agent-memory answer-pattern guidance.
2. Run `bun test src/server/chat/agent-memory.test.ts`.
3. Broaden required evidence planning by request class.
4. Add generic decision metadata or minimal card/itinerary decision fields.
5. Improve ranking/local-fit rules in the relevant local tools.
6. Add cross-request regression tests.
7. Run targeted tests, then the broader local gates.

## Validation Commands

Use targeted checks while implementing:

```sh
bun test src/server/chat/agent-memory.test.ts
bun test src/server/chat/ask-siargao-agent.test.ts
bun test src/server/chat/agent-runtime.test.ts
bun test src/app/api/chat/route.test.ts
```

Add tool-specific tests as touched:

```sh
bun test src/server/chat/itinerary-tools.test.ts
bun test src/server/chat/condition-tools.test.ts
bun test src/server/chat/local-data-tools.test.ts
bun test src/server/chat/agent-tools.test.ts
```

Before merge, run the repo gates that are green for the current branch:

```sh
bun run lint
bun run typecheck --incremental false
bun test
bun run build
```

Run `bun run test:e2e` after UI changes or chat artifact rendering changes.

## Continue / Kill Criteria

Continue if Ask Siargao is clearly better than ChatGPT for several request classes:

- it answers the exact request first;
- it uses checked local tools only where they matter;
- it gives a practical best action, fallback, or skip recommendation;
- it preserves area, time, transport, budget, group, and activity constraints;
- it shows structured UI artifacts that make the next move easier;
- it avoids generic tourist filler.

Kill or revise this approach if:

- most improvement requires large prompt additions in `askSiargaoBaseInstructions`;
- every request gets forced into the same itinerary shape;
- source caveats dominate the answer;
- the UI repeats prose instead of clarifying the decision;
- the product only wins on one Cloud 9 regression and not on broader Siargao requests.

