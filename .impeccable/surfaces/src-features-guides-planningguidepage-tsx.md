---
version: 1
slug: "src-features-guides-planningguidepage-tsx"
primary_target: "src/features/guides/PlanningGuidePage.tsx"
related_targets: ["src/features/guides/PlanningGuidesHubPage.tsx"]
---

# Planning Guides: Compass Route

## Scope and mode

This brief governs the long-form planning-guide reader and its guides hub. The visitor mode is
**Read**: comprehension and wayfinding come first, with a contextual handoff into an explicitly
submitted Reality Check after the static guide has delivered a useful answer.

## Audience, job, and action

The reader is planning a Siargao trip or revising one on-island. They need to understand the
guide's recommendation, compare viable options, follow a practical sequence, and distinguish
durable guidance from details that need a current check. The primary action is to open the Reality
Check that matches their constraint; the hub's action is to choose the decision most relevant to
their trip.

## Proof and content

- Lead with a decisive editorial title, original island image, authorship/review metadata, checked
  date, reading time, and a visible path into the guide or Reality Check.
- Give the complete static answer in this order: quick recommendation, comparison, route sections,
  travel-time ranges and schematic map, contextual Reality Check, sources and limitations, FAQs,
  then related guides.
- Make trust operational: label ranges as planning estimates, label the map as schematic and not to
  scale, link sources directly, and keep limitations adjacent to the claims they qualify.

## Chosen direction

Extend the established **Island Field Desk** through a **compass route** editorial structure. Deep
coastal-night framing opens into warm paper reading surfaces; Cormorant carries editorial hierarchy
while Nunito carries operational copy, evidence, labels, and actions. A route-like contents rail and
repeated orientation cues make the long guide feel traversable without turning it into a dashboard.

The memorable moment is the reader moving from the visible “Follow the route” spine through the
schematic island map into “Turn the guide into today's decision”: the editorial route resolves into
a specific, constraint-aware Reality Check rather than a generic chat prompt.

Direction provenance: concept seed `263e141a`, candidate 5.

## Constraints

- Preserve the existing design world; this surface does not create new project-wide tokens or
  component doctrine.
- Keep the static guide complete before asking the reader to enter chat.
- Never present travel-time ranges as live estimates or the schematic map as navigation.
- Do not imply live weather, tide, transport, availability, closure, or safety confirmation until
  the reader explicitly submits a Reality Check.
- Preserve responsive reading order, keyboard-visible wayfinding, accessible horizontal comparison,
  descriptive image text, and a clear first-viewport action.
- Use original or governed island imagery and source-visible factual copy; do not invent local proof,
  endorsements, availability, or guarantees.

## Unresolved decisions

None at shipment. Future guide types may extend the content schema, but they should keep this reader
journey unless research shows a materially different planning job.
