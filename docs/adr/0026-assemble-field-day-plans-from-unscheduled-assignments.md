# Assemble Field Day Plans from unscheduled Assignments

Field Campaigns keep versioned Field Assignments unscheduled rather than assigning them fixed dates.
When preparing an outing, Ask Siargao deterministically proposes a Field Day Plan from eligibility,
practical travel compatibility, capacity, evidence priority, and safety constraints; the Field
Researcher may adjust the proposal with visible coverage consequences. Optional live preflight data
is preserved with its retrieval context so the confirmed plan remains usable offline, and unsafe or
ineligible work is excluded before geographic scoring. Planning uses a versioned Travel Compatibility
Graph and stable lexicographic rules rather than live routing or LLM judgement: rare eligibility
windows, travel compatibility, outstanding coverage, editorial priority, time fit, and stable identity
resolve proposals in that order after hard safety and feasibility gates.
