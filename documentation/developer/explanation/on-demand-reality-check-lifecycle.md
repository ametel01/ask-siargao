# On-Demand Reality Check Lifecycle

Ask Siargao treats a Reality Check as a specialized result inside the existing chat turn, not as a
separate service. Work begins only when a traveler submits a message to `/api/chat`. Opening the
landing page or `/chat`, including a prompt deep link, does not run the agent.

This design keeps the product boundary narrow: it offers Siargao-specific judgment at request time
without promising later monitoring, proactive alerts, operator outreach, booking, or guaranteed
availability.

## Request Lifecycle

```text
explicit chat submission
  -> recognize whether the traveler explicitly requested a Reality Check
  -> request focused missing context when the subject or plan is incomplete
  -> let the agent choose governed evidence tools
  -> complete prerequisite evidence before dependent enrichment
  -> parse the model's bounded Reality Check proposal
  -> validate kind, evidence references, source sufficiency, and claim boundaries
  -> build one server-owned decision summary
  -> allowlist selected cards and itineraries
  -> sanitize the public response and authenticated-history payload
  -> return the completed chat turn
```

The recognizer in `src/server/chat/reality-check.ts` is deliberately narrow. It classifies an
explicit request into a Reality Check kind and identifies essential missing context. It does not
precompute the recommendation or replace the agent's normal tool choice.

## Proposal and Server Ownership

For a complete explicit request, the structured model response includes a `realityCheck` proposal.
The proposal contains the proposed verdict and decision text plus IDs of completed evidence calls.
It cannot contain source objects or choose the public decision-summary ID.

`src/server/chat/ask-siargao-agent.ts` parses that proposal and passes it to
`validateRealityCheckProposal()`. Only an accepted proposal becomes a public `DecisionSummary`.
The server derives its sources from completed tool results and generates its opaque ID. This split
lets the model express judgment while deterministic code owns public evidence and artifact identity.

## Source Sufficiency and Provider Failure

A decisive `keep`, `change`, or `avoid` verdict needs at least one successful verifying source.
Immediate-plan and surf-session decisions also need successful request-time condition evidence.
Surf sessions require a condition judgment plus marine or tide evidence, and named accommodation
checks require successful Places identity evidence.

When some requested checks succeed and others fail, the summary may remain usable with a `partial`
source state if its decision is supported by the successful evidence. When required evidence is
unavailable, a positive proposal cannot pass as checked. A terminal provider failure can support a
bounded fallback with `needs_confirmation`; it cannot support invented facts, checked labels, or a
positive recommendation card.

Unsupported claims fail at the same boundary. Accommodation output cannot state unverified noise,
flooding, Wi-Fi, power, room-condition, or availability qualities as facts. Surf output cannot
guarantee that a session is safe. Disruption recovery cannot claim that the app detected an event,
contacted someone, reserved anything, or guaranteed availability.

## Semantic Evidence Ordering

Some evidence has an upstream/downstream relationship rather than merely a presence requirement.
For example, current conditions must finish before surf ranking, and route or weather prerequisites
must finish before itinerary-dependent Places enrichment. Disruption recovery completes condition
and governed local-fact checks before dependent replacement work.

This ordering is enforced in the agent turn rather than inferred from the final list of tool calls.
Regression tests use deferred upstream promises and assert that downstream work has not started
while the prerequisite remains pending. A green response-shape test alone is not sufficient evidence
for an ordering contract.

## Artifact and Privacy Boundaries

The final structured payload selects public artifacts by ID. Runtime allowlists further restrict
those selections to artifacts relevant to the recognized Reality Check and produced by successful,
used evidence calls. Explicit mixed selections therefore cannot expose an unrelated card or
itinerary, and artifacts attached to failed provider results are not selectable.

Public-turn assembly sanitizes the resulting summary, cards, itineraries, sources, and tool-call
metadata before response or persistence. Authenticated history stores traveler-visible text and
sanitized public artifacts. It does not store exact browser coordinates, private tool arguments,
raw provider payloads, or internal caveats as public Reality Check content.

Old stored decision summaries remain valid because `kind`, `verdict`, and `subject` are optional on
the persisted `DecisionSummary` shape. Hydration preserves those legacy summaries without inventing
new semantics.

## Why the Lifecycle Is Synchronous

The value proposition is evidence-backed local judgment when a traveler asks. Keeping the complete
lifecycle inside one chat request makes the trigger, evidence timestamp, response, cost, and failure
state observable together. It also avoids creating an operational promise that would require an
always-available agent or human desk after the traveler has left the app.
