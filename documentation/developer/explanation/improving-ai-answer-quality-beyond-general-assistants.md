# Improving AI Answer Quality Beyond General Assistants

Ask Siargao should be materially better than a general assistant when a traveler needs a practical,
current Siargao decision. It should not try to win through a longer persona prompt or broader general
reasoning. Its advantage should come from governed local evidence, durable trip context, decisive
answer behavior, and a quality loop that proves those capabilities improve the traveler's next move.

The current architecture provides a strong foundation: model-owned final prose, governed tools,
source-label validation, Siargao memory, weather and marine checks, Places enrichment, map cards,
and structured Reality Checks. The remaining problem is consistency. The codebase does not yet
measure comparative answer quality, some current-evidence paths can accept weak evidence, and the
agent loses useful context during realistic multi-turn trips.

## Competitive Standard

The product strategy already defines the relevant comparison. Ask Siargao should win on questions
such as:

- what is open, nearby, and sensible now;
- how weather, tides, or transport change a plan;
- which beach, surf spot, restaurant, service, or activity fits the traveler's constraints;
- whether an itinerary or accommodation choice is practical;
- what the current nightlife route or arrival plan should be.

The comparison should include both the same underlying model without Ask Siargao tools or memory
and the current consumer ChatGPT experience with web or maps where available. The benchmark must
record its model, provider, evidence snapshot, and date because the general-assistant baseline
changes over time.

## Prioritized Findings

| Priority | Improvement | Impact | Effort | Fix risk |
| ---: | --- | --- | --- | --- |
| 1 | Build a blinded comparative answer benchmark | The central product advantage is currently unmeasured. | Large | Low |
| 2 | Preserve server-authoritative trip context | Important constraints disappear after a short conversation. | Medium to large | Medium |
| 3 | Harden current web evidence | Stale or misclassified sources can weaken the trust advantage. | Medium | Medium |
| 4 | Require differentiating evidence paths | Nightlife, ferry, closure, and logistics answers can omit the tools that should make the product special. | Medium | Low to medium |
| 5 | Close thin-answer validation gaps | A cited but generic answer can pass despite rich tool output. | Small | Medium |
| 6 | Turn ratings into an improvement loop | Existing feedback is too sparse and unstructured to explain answer failures. | Medium | Medium |
| 7 | Reduce time to useful prose | Progress events arrive early, but the actual answer arrives only after the full agent run. | Large | High |

## Measure Answer Quality, Not Only Runtime Contracts

The existing evaluation artifacts are valuable structural checks, but they do not establish that a
traveler-facing answer is better than a general assistant's answer.

- `src/server/evaluations/reality-check-matrix.ts:77` evaluates recognition and fail-closed
  contracts without generating and grading the final traveler answer.
- `src/server/evaluations/trip-pass-cost-baseline.ts:499` records evidence, ordering, artifact, and
  safety contracts while returning a fixture-owned `pass` result.
- `src/server/evaluations/trip-pass-quality-bypass.ts:83` copies expected outcomes into observed
  outcomes for its bypass matrix.
- `docs/evaluations/trip-pass-quality-bypass-2026-07-14.json:222` explicitly says the artifact does
  not claim unmeasured model superiority.

Create a versioned corpus of 75 to 150 prompts covering:

- open-now food and local services;
- beaches, swimming, surf, tides, and weather-sensitive plans;
- nightlife and current events;
- airport, port, ferry, and local transport logistics;
- accommodation and itinerary decisions;
- clinics, pharmacies, and urgent local assistance;
- kids, no-scooter, budget, dietary, accessibility, and ride-time constraints;
- multi-turn corrections and references to earlier decisions;
- stale, conflicting, insufficient, and unavailable evidence.

Run paired answers through Ask Siargao and the selected general-assistant baselines. Blind and
randomize the answers, then score factual grounding, freshness, constraint preservation, local
judgment, actionability, map usefulness, uncertainty calibration, concision, and latency. Report
win, tie, and loss rates per question class rather than only one aggregate score.

This benchmark should start as a release-candidate evaluation. A smaller deterministic, redacted
smoke corpus can later become a required CI gate.

## Preserve Trip Context Across the Whole Trip

The client sends only six prior complete messages in
`src/features/chat/ChatWorkspace.tsx:220` and
`src/features/chat/ChatWorkspace.tsx:6766`. The API validates and persists an authenticated thread,
but `src/app/api/chat/chat-route.ts:923` does not reconstruct model context from stored thread
history. In a normal alternating conversation, details can therefore disappear after roughly three
exchanges.

Saved profile context does not fully close the gap. `safeTripContextSummary()` in
`src/server/chat/trip-context.ts:714` includes area and bounded traveler preferences but omits saved
accommodation identity and trip dates. That conflicts with the product promise to remember the
traveler's accommodation, dates, budget, and constraints throughout the trip.

Build server-authoritative model context from:

1. a bounded window of recent verbatim turns;
2. a durable structured trip summary;
3. a compact record of accepted and rejected recommendations or itinerary decisions;
4. normalized public accommodation identity, coarse area, and trip dates;
5. privacy-safe constraint tokens rather than unrestricted profile notes.

Tests should introduce important constraints more than three exchanges earlier and verify that
later recommendations still obey them. They should also prove that room numbers, private notes,
exact coordinates, and unrelated profile data do not cross the model boundary.

## Harden Current-Evidence Trust

Current answers should be more trustworthy than generic web synthesis, not merely more decorated.
Two boundaries need tightening.

First, freshness is currently a score contribution rather than an eligibility rule.
`src/server/chat/web-research.ts:135` gives official and government sources a high authority score,
while `src/server/chat/web-research.ts:471` only penalizes stale or undated material. An authoritative
but old page can therefore remain eligible for a same-day schedule, closure, ferry, event, or safety
claim.

Second, hosted web search asks the extraction model to emit `sourceType` in
`src/server/providers/web-search.ts:148`. The parsed classification can ultimately produce an
`official_checked` label through `src/server/chat/agent-tools.ts:1920`.

Treat requested freshness as a separate eligibility gate. Permit explicit exceptions only for
stable recurring schedules whose recurrence is supported and whose current use is clearly bounded.
Treat model-provided authority as a hint; determine official, government, directory, and ordinary
web status from normalized domains and governed source profiles. Unknown domains should remain
ordinary web research.

## Require the Tools That Create the Advantage

Exposing a tool is not the same as requiring the evidence needed for a reliable answer.

- `src/server/chat/agent-tool-selection.ts:68` exposes nightlife event, web research, and Places
  tools, but `src/server/chat/required-evidence.ts:66` does not construct a nightlife requirement.
- Ferry, closure, arrival, departure, road, and timetable language is not consistently routed to
  both current web evidence and governed route facts.
- The nightlife repair at `src/server/chat/ask-siargao-agent.ts:2456` can force recurring baseline
  venues after the internal event lookup returns no events without first preferring successful
  current web evidence.

Add explicit evidence plans for:

- event or research evidence before nightlife Places enrichment;
- current official research before ferry schedules, closures, and advisories;
- governed route facts as supporting context for transport answers;
- bounded urgent-service lookup for hospitals, clinics, pharmacies, and emergency assistance.

Required-evidence tests should cover adversarial natural phrasing, provider failure, mixed results,
and the semantic ordering between upstream evidence and downstream enrichment.

## Enforce Useful Synthesis

The base prompt asks for structured, practical answers, but the validator can accept a thin answer.
In `src/server/chat/ask-siargao-agent.ts:2179`, the runtime computes whether an answer is structured.
The branch at `src/server/chat/ask-siargao-agent.ts:2219` still accepts any answer that selects at
least one evidence call and avoids a recognized punt phrase.

Validation should distinguish genuine single-result answers from multi-option evidence. When tools
return multiple useful options, require the final answer to cover the selected options, explain fit
or tradeoffs, and state a first move. Single-result questions should remain concise.

The prompt layers also need one uncertainty contract. The base response contract at
`src/server/chat/ask-siargao-agent.ts:4714` forbids internal verification-gap language, while
`docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md:135` requires the traveler to understand when
current evidence could not be verified. Preserve the ban on tool and API jargon, but permit direct
traveler language such as:

> I could not confirm tonight's schedule from a current official source, so use this as route
> guidance rather than a confirmed departure time.

## Make Local-Operator Behavior Always Available

Detailed answer patterns currently live in optional memory. The always-on instructions should
contain a compact decision rubric:

- give the best move in the first sentence;
- preserve area, timing, budget, transport, group, dietary, accessibility, and weather constraints;
- recommend one to three options instead of a generic island list;
- explain the decisive Siargao-specific tradeoff;
- challenge a materially bad tourist assumption;
- give one concrete next action;
- ask one short question only when the missing detail could change the decision;
- never imply firsthand experience, operator contact, booking, or local relationships.

Keep detailed request patterns retrievable. Do not turn the system prompt into a large character
backstory.

## Build the Owned Local Data Moat

The substantive destination-memory packs in `src/server/chat/agent-memory.ts:62` mainly cover surf,
beaches, and nightlife. The baseline seed in `src/server/db/seed.ts:18` adds areas, routes, providers,
and source profiles but no broad operational service corpus.

Build governed operational data packs in this order:

1. airport, Dapa Port, ferry, van, tricycle, and transfer logistics;
2. clinics, hospitals, pharmacies, emergency contacts, and capability boundaries;
3. rainy-day and covered activities by area;
4. scooter rentals, delivery, deposits, helmets, and transport alternatives;
5. ATMs, cash, SIM support, laundry, work suitability, and power caveats;
6. area-specific accommodation tradeoffs;
7. common tourist traps and unrealistic route combinations.

Store decision-relevant attributes rather than copying directories. Useful attributes include
whether an option is realistic without a scooter, remains workable in heavy rain, fits a short ride
limit, or is appropriate for a specific local need. Every pack needs source ownership, freshness
windows, review responsibility, licensing boundaries, and a safe degraded state.

Large surf and beach documents should eventually be split into focused, metadata-addressable
sections or canonical structured records. Loading an entire long guide for a narrow question adds
cost and can make the decisive local distinction less salient.

## Turn Traveler Feedback Into Training Data for the Product

The rating API supports reason codes and comments in
`src/app/api/chat/ratings/rating-route.ts:8`, but the client sends only `messageId` and the binary
rating in `src/features/chat/ChatWorkspace.tsx:1199`. Rating controls are hidden below the desktop
breakpoint at `src/features/chat/ChatWorkspace.tsx:4492`, and anonymous responses do not receive an
authenticated assistant message ID.

Show rating controls on mobile, ask for one lightweight reason after a negative rating, expose save
failures, and design a privacy-safe anonymous feedback mechanism. Join feedback to coarse answer
cohorts such as intent, final provider/model, fallback use, evidence state, memory version, latency,
and prompt version. Do not place raw prompts, exact coordinates, private profile notes, or provider
payloads in analytics.

Regularly promote representative negative-feedback cases into the comparative evaluation corpus.

## Reduce Time to Useful Output

The NDJSON route at `src/app/api/chat/chat-route.ts:677` streams progress states, then emits the full
result after the agent finishes. This improves perceived activity but not time to useful answer
prose. It also makes a generic first-byte metric look faster than the first model-derived output.

Track separate timings for request acceptance, first model-derived content, and final validated
answer. Explore answer-delta streaming or an early validated answer skeleton only after defining how
partial prose remains consistent with final source and artifact validation. Do not let progressive
rendering bypass the authoritative structured result.

Automatic location capture should also avoid delaying named-location questions. The `nearby` match
in `src/features/chat/ChatWorkspace.tsx:6779` can request precise location even when the prompt names
Cloud 9 or another clear anchor. Restrict automatic capture to deictic phrases such as `near me` or
`where I am`, show the submitted user message immediately, and offer a visible continuation path
without location.

## Recommended Delivery Order

1. Establish the comparative benchmark and answer-quality rubric.
2. Fix freshness, authority classification, and required-evidence routing.
3. Add server-authoritative long-term trip and decision context.
4. Close thin-answer validation and unify the uncertainty contract.
5. Build operational data packs based on benchmark losses and observed user demand.
6. Connect traveler ratings to the evaluation corpus and model/prompt cohorts.
7. Optimize time to useful answer without weakening source validation.

Do not fine-tune a model, add a large persona backstory, or expand generic web search before these
steps. Those changes are difficult to evaluate and do not create the durable local advantage
described by the product strategy.

## Assessment Scope

This assessment covers the chat runtime, prompt and memory design, local-data tools, evaluation
artifacts, traveler feedback, trip context, and chat response UX. It does not include live provider
runs, production analytics or PostHog data, or a full audit of commerce, deployment, dependencies,
and unrelated application surfaces.
