# Plan 013: Align source-caveat memory with the chat response contract

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8775d60..HEAD -- src/server/chat/ask-siargao-agent.ts src/server/chat/ask-siargao-agent.test.ts src/app/api/chat/route.test.ts docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md docs/agent-memory/INDEX.md documentation/developer/explanation/chat-agent-routing-and-source-governance.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts
> against the live code before proceeding; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `8775d60`, 2026-07-08
- **Issue**: https://github.com/ametel01/ask-siargao/issues/86

## Why this matters

The runtime currently tells the model not to print `Checked:` or `Not checked:` footer lines and
tests enforce that traveler prose avoids internal source mechanics. The loaded agent-memory source
policy still tells the model to use `Checked:` and `Not checked:` lines. Because those memory files
are model-facing instructions, this is not just stale documentation: it creates competing guidance
inside the chat agent. Align the memory and docs with the current response contract while preserving
the important product rule that missing live checks must not be upgraded into checked claims.

## Current state

- `src/server/chat/ask-siargao-agent.ts` builds the model instructions and final-output contract.
- `docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md` and
  `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md` are loaded as model memory and describe source
  caveat behavior.
- `src/server/chat/ask-siargao-agent.test.ts` and `src/app/api/chat/route.test.ts` currently assert
  traveler prose does not expose internal source mechanics.

Runtime excerpts:

```ts
// src/server/chat/ask-siargao-agent.ts:3516-3519
caveats:
  "Do not mention internal verification gaps or tool boundaries to the traveler. Never say live-check, not checked, unchecked, source caveats, tool, API, evidence, artifact, overclaim, or user constraints preserved. Convert uncertainty into practical advice only when useful, such as keep the stop flexible, avoid exposed rides in heavy rain, or check conditions before swimming.",
structuredAnswerQuality:
  "For any evidence-backed result returned to the traveler, synthesize the evidence into a structured answer. Use a compact table or tight option list for comparisons and multiple results; use a concise heading plus key details for single-result answers. Include concrete names, area, checked details, tradeoffs, caveats, and a clear next move when available. Do not ask whether the traveler wants details that are already present in tool output.",
```

```ts
// src/server/chat/ask-siargao-agent.ts:3544-3546
"Do not invent live, provider-backed, or curated local facts. Memory retrieval is policy/reference context only, not live evidence.",
"Do not write standalone source footer lines beginning with 'Checked:' or 'Not checked:'. Do not tell the traveler what was not checked or which internal tool should be used. Let the backend/cards display compact source labels.",
"Keep answers concise and actionable.",
```

Model-facing memory excerpts:

```md
<!-- docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md:92-101 -->
## Checked And Not Checked Wording

Use "Checked:" lines only for tool-backed facts represented by verifying source
labels: `live_checked`, `fresh_cache`, `curated_local_guide`, and
`event_checked`, `venue_checked`, `weather_checked`, `marine_checked`,
`tide_forecast_checked`, `community_signal`, `web_researched`,
`official_checked`, and `directory_checked`.

Use "Not checked:" lines for missing fields, unavailable providers, generic
reasoning boundaries, or facts that the tool did not verify.
```

```md
<!-- docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md:132-150 -->
If a live status was not checked, say so. If a cache was used, do not imply that
open-now, booking, table availability, room availability, reviews, surf, swell,
tides, event schedule, crowd size, door policy, road flooding, closures, or
safety conditions were checked unless a tool output explicitly says so.
...
If a condition judgment says tide, surf, swell, current, road, lifeguard, or
safety signals were not checked, preserve the caveats that affect the requested
decision in the final answer.
```

Existing tests assert the current no-internal-prose contract:

```ts
// src/server/chat/ask-siargao-agent.test.ts:6306-6327
function assertTravelerProseHasNoInternalMechanics(message: string) {
  const normalizedMessage = message.toLowerCase();
  for (const bannedTerm of [
    " tool",
    "api",
    "artifact",
    "required check",
    "fallback promotion",
    "source caveat",
    "live_checked",
    "not_checked",
    "not checked",
```

Repo conventions to match:

- Keep model-owned tool choice intact. Do not reintroduce route-owned deterministic answer prose.
- Preserve source-governance validation in `src/server/chat/source-consistency.ts`.
- Update agent-memory docs as model-facing behavior instructions, not as generic product copy.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Agent tests | `bun test src/server/chat/ask-siargao-agent.test.ts src/app/api/chat/route.test.ts src/server/chat/source-consistency.test.ts` | exit 0, all targeted tests pass |
| Memory sync dry run | `bun run agent-memory:sync -- --dry-run` | exit 0; if this command has drifted, document the observed command and stop if it needs provider credentials |
| Lint | `bun run lint` | exit 0, Biome reports no fixes applied |
| Typecheck | `bun run typecheck --incremental false` | exit 0, no TypeScript errors |
| Full tests | `bun test` | exit 0, all Bun tests pass |

## Scope

**In scope**:

- `docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md`
- `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md`
- `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md`
- `docs/agent-memory/INDEX.md`
- `documentation/developer/explanation/chat-agent-routing-and-source-governance.md`
- `src/server/chat/ask-siargao-agent.ts`
- `src/server/chat/ask-siargao-agent.test.ts`
- `src/app/api/chat/route.test.ts`
- `src/server/chat/source-consistency.test.ts`

**Out of scope**:

- Removing source-consistency validation.
- Changing public response DTOs, card schemas, or saved-trip source schemas.
- Reverting to deterministic route-authored final answers.
- Adding new source labels.

## Git workflow

- Branch: `advisor/013-align-source-caveat-contract`
- Commit message style: short imperative, for example `Align source caveat guidance`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Decide and document the single public wording contract

Use the current runtime and tests as the default contract:

- traveler prose should not print standalone `Checked:` / `Not checked:` footer lines;
- traveler prose may include practical caveats when they change the decision;
- source labels and detailed checked/not-checked arrays remain structured metadata in cards,
  artifacts, and backend validation;
- missing live/provider checks must never be phrased as checked facts.

Update `docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md` so "Checked And Not Checked Wording" no
longer tells the model to write literal footer lines. Replace it with instructions to:

- keep checked/not-checked labels as structured source metadata;
- translate material gaps into natural traveler wording only when useful;
- avoid internal labels and tool names in normal prose.

**Verify**:
`rg -n 'Use "Checked:"|Use "Not checked:"|standalone source footer' docs/agent-memory src/server/chat/ask-siargao-agent.ts`
shows the updated memory and the runtime contract without contradictory model-facing instructions.

### Step 2: Align tool-use memory with the same caveat rule

In `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md`, keep the rule that absent live checks cannot
support checked claims. Rephrase "say so" guidance to match the no-internal-prose contract, for
example:

- preserve material traveler-impacting caveats;
- avoid literal "not checked" wording unless a product owner explicitly changes the runtime tests;
- use practical advice such as "call ahead", "keep it flexible", or "confirm locally" when the
  missing check matters.

Also update `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md` and `docs/agent-memory/INDEX.md` if they
still direct the model toward literal checked/not-checked footer wording.

**Verify**:
`rg -n 'checked/not-checked|Not checked:|Checked:' docs/agent-memory` returns only aligned guidance
or examples explicitly marked as structured metadata, not final-prose instructions.

### Step 3: Tighten runtime wording if needed

Review `buildAskSiargaoBaseInstructions()` and `baseResponseContract` in
`src/server/chat/ask-siargao-agent.ts`. If the existing instructions are clear after memory changes,
leave code untouched. If they still conflict, adjust only the instruction strings to use one
consistent vocabulary:

- no standalone source footer lines;
- no internal tool/source-label terms in traveler prose;
- material caveats are allowed as practical advice.

Do not change tool schemas or source validation.

**Verify**:
`bun test src/server/chat/ask-siargao-agent.test.ts src/app/api/chat/route.test.ts src/server/chat/source-consistency.test.ts`
exits 0.

### Step 4: Add regression coverage for the memory/runtime alignment

Add a focused test where the model loads source/tool memory and receives an output that would be
ambiguous under the old docs. The expected behavior should prove:

- source metadata remains available through structured cards/sources where applicable;
- traveler prose does not contain literal `Checked:` / `Not checked:` footer lines or internal
  source labels;
- a material missing check still appears as practical advice when the prompt requires it.

Use existing helpers in `src/server/chat/ask-siargao-agent.test.ts` rather than building a new test
harness.

**Verify**:
`bun test src/server/chat/ask-siargao-agent.test.ts` exits 0.

## Test plan

- Agent runtime tests for memory-loaded source-policy guidance.
- Route tests for stripped or rejected internal source mechanics should continue to pass.
- Source-consistency tests should continue to enforce that checked labels are tool-backed.
- Memory dry run should complete without requiring provider credentials.

## Done criteria

- [ ] Model-facing memory no longer instructs the assistant to write literal `Checked:` /
      `Not checked:` final-prose lines.
- [ ] Runtime instructions, route tests, and source-policy memory describe one consistent public
      caveat contract.
- [ ] Source labels and checked/not-checked arrays remain structured metadata and validation inputs.
- [ ] Missing provider checks still fail closed and cannot become checked claims.
- [ ] `bun test src/server/chat/ask-siargao-agent.test.ts src/app/api/chat/route.test.ts src/server/chat/source-consistency.test.ts` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run typecheck --incremental false` exits 0.
- [ ] `bun test` exits 0.

## STOP conditions

Stop and report back if:

- Product direction has changed and the maintainer wants literal `Checked:` / `Not checked:` footer
  lines restored in traveler prose.
- Alignment requires changing public response schemas or saved-trip artifact schemas.
- The memory sync command requires live provider credentials or mutates remote state outside a
  dry-run path.

## Maintenance notes

Whenever source-label behavior changes, update both runtime tests and model-facing memory in the
same PR. Treat `docs/agent-memory/*` as executable behavior context, not passive documentation.
