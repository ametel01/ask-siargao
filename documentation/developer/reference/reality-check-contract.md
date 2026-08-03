# Reality Check Contract Reference

The source of truth is `src/server/chat/reality-check.ts`. Reality Checks use the existing
`POST /api/chat` request and response lifecycle.

## Execution Mode

| Constant | Value |
| --- | --- |
| `realityCheckExecutionMode` | `on_demand` |

No Reality Check execution is triggered by page load. A traveler message must be submitted before
the chat route runs.

## Kinds

| Kind | Request subject | Essential context |
| --- | --- | --- |
| `accommodation` | Named property or explicit area comparison | Property/area subject |
| `itinerary` | Traveler-supplied itinerary or bounded plan | Plan details |
| `immediate_plan` | Today, tomorrow, or immediate activity decision | Activity |
| `surf_session` | Session fit for a traveler and time | Skill level, location, timing |
| `disruption_recovery` | Traveler-reported cancellation, closure, illness, weather, or transport disruption | Disruption |

Recognition returns `{ explicit, kind?, missingContext }`. Missing-context values are `subject`,
`plan`, `activity`, `disruption`, `skill_level`, `location`, and `timing`.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `keep` | Available evidence supports keeping the submitted choice or plan. |
| `change` | The plan remains workable after a concrete revision. |
| `avoid` | Available evidence supports not proceeding with the submitted option. |
| `needs_confirmation` | A required fact is unavailable or too weak for a decisive verdict. |

`needs_confirmation` is a bounded decision state, not a promise that Ask Siargao will confirm the
fact later.

## Structured Proposal

The optional final-payload field is `realityCheck`.

| Field | Type | Required | Limit or rule |
| --- | --- | --- | --- |
| `kind` | Reality Check kind | Yes | Must match the server-recognized kind. |
| `verdict` | Reality Check verdict | Yes | One of the four normalized verdicts. |
| `subject` | String | Yes | 1–160 characters. |
| `bestAction` | String | Yes | 1–320 characters. |
| `basis` | String | Yes | 1–600 characters. |
| `fallback` | String | No | 1–320 characters when present. |
| `avoid` | String | No | 1–320 characters when present. |
| `timing` | String | No | 1–120 characters when present. |
| `area` | String | No | 1–160 characters when present. |
| `evidenceToolCallIds` | String array | Yes | At most 12 unique, non-empty completed call IDs. |

The schema is strict. Unknown fields, oversized strings, invalid enum values, and malformed arrays
are rejected. `null` is accepted only for optional text and normalized to absence.

## Validation Results

`validateRealityCheckProposal()` returns either a valid value or an invalid reason.

| Invalid reason | Boundary enforced |
| --- | --- |
| `kind_mismatch` | Proposal kind differs from recognized kind. |
| `missing_evidence` | No usable evidence reference or source exists. |
| `unknown_evidence_tool_call` | Referenced call/result pair is absent. |
| `unused_evidence_tool_call` | Referenced call is not in `usedToolCallIds`. |
| `incomplete_evidence_tool_call` | Call and result name or status disagree. |
| `insufficient_source_evidence` | No successful verifying source supports a decisive verdict. |
| `missing_current_evidence` | Immediate or surf decision lacks successful current evidence. |
| `missing_condition_judgment` | Surf decision lacks `get_condition_judgment`. |
| `missing_surf_evidence` | Surf decision lacks checked marine or tide evidence. |
| `missing_property_evidence` | Named property decision lacks Places identity evidence. |
| `unsupported_accommodation_claim` | Proposal asserts an unverified property quality. |
| `unsupported_surf_safety_claim` | Proposal guarantees surf safety. |
| `unsupported_disruption_claim` | Proposal claims monitoring, intervention, booking, or guaranteed availability. |

Terminal `provider_unavailable` or `insufficient_web_evidence` sources may produce an invalid result
with a server-bounded `needs_confirmation` fallback. They do not turn into verifying sources.

## Public Decision Summary

A validated proposal becomes one server-generated `DecisionSummary`:

```ts
type DecisionSummary = {
  id: string;
  kind?: RealityCheckKind;
  verdict?: RealityCheckVerdict;
  subject?: string;
  bestAction: string;
  basis: string;
  fallback?: string;
  avoid?: string;
  timing?: string;
  area?: string;
  sources: readonly AnswerSourceSummary[];
};
```

The server owns `id` and `sources`. The optional `kind`, `verdict`, and `subject` fields preserve
compatibility with decision summaries stored before the Reality Check contract was added.

The `/api/chat` response includes selected summaries in `decisionSummaries`. Cards and itineraries
remain separate arrays and are returned only when selected and allowed. The model-facing proposal's
`evidenceToolCallIds` are not copied into the public summary.

## Source States

| State | Meaning |
| --- | --- |
| `checked` | Successful evidence includes at least one verifying source and no terminal gap. |
| `partial` | Supporting verifying evidence exists, but another referenced check failed or is unavailable. |
| `unavailable` | No verifying evidence supports the requested decision. |

Source labels that can verify a decisive result are defined by the contract and include checked
Places, current weather/marine/tide, governed local guide, and qualifying public-web labels. Failure
and not-verified labels never count as verifying evidence.
