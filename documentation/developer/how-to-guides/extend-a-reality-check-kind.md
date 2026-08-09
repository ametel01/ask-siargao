# Extend a Reality Check Kind

Use this procedure when adding a new on-demand decision category or materially changing the evidence
contract for an existing category.

## 1. Define the Domain Contract

Update `src/server/chat/reality-check.ts`:

1. Add the kind to `realityCheckKinds`.
2. Add narrow explicit-request recognition.
3. Define the essential context that must be present before a verdict can be proposed.
4. Add kind-specific source-sufficiency and unsupported-claim validation.

Keep recognition pure. It may identify the category and missing context, but it must not execute
tools, assemble an answer, or turn ordinary Siargao questions into forced verdicts.

## 2. Add Governed Evidence Behavior

Update the agent instructions and tool descriptions in `src/server/chat/ask-siargao-agent.ts` and
`src/server/chat/agent-tools.ts`. Add a narrow required-evidence policy only when the agent needs a
repair for omitted mandatory evidence.

When evidence has prerequisites, encode the dependency explicitly. Await the upstream condition,
route, or governed-fact result before starting dependent Places, ranking, or itinerary work. Do not
rely on final tool-call array order as proof.

Keep provider cache/live choice, field masks, retention, and display rules inside the relevant
provider boundary. Do not pass raw provider payloads into the public Reality Check proposal.

## 3. Validate Before Public Projection

Require the final structured proposal to reference only completed calls also listed in
`usedToolCallIds`. Derive public sources from those tool results. Generate the public summary ID on
the server.

Decide which cards and itineraries can accompany the verdict. Intersect model-selected artifact IDs
with the successful, used, kind-relevant allowlist before calling strict public-turn assembly.

Provider failure must fail closed. If the missing evidence is required for the verdict, return a
bounded `needs_confirmation` result or a focused retry/clarification path. Do not expose failed
provider cards.

## 4. Preserve Compatibility and Privacy

Keep new persisted summary fields optional unless a migration plan covers old history rows. Exercise
the authenticated save/hydrate path and public-turn sanitizer.

Verify that responses and stored history exclude exact coordinates, private tool arguments, raw
provider payloads, internal caveats, and unsupported source labels. Observability should record only
allowlisted coarse outcome fields.

## 5. Add Regression Coverage

At minimum, add tests for:

- explicit recognition and ordinary-question non-recognition;
- each missing essential input;
- a supported decisive verdict;
- complete provider failure and partial evidence;
- unsupported checked/current or operational claims;
- legacy summaries without new optional fields;
- omitted or auto-selected artifacts;
- adversarial explicit mixed `displayCardIds` and, when relevant, mixed itinerary IDs;
- semantic ordering using a deferred upstream promise that proves downstream work has not started.

Add a representative synthetic prompt and contract expectation to
`src/server/evaluations/reality-check-matrix.ts`, then run:

```sh
bun run eval:reality-check
bun test src/server/evaluations/reality-check-matrix.test.ts
bun run verify:foundation:local
```

If the change alters traveler-visible behavior, add a concise `[Unreleased]` changelog entry. If it
changes the public contract, update the Reality Check contract reference and routes/surfaces
reference in the same step.
