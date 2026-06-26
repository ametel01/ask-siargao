# Product Docs

These documents capture planning and research notes for Ask Siargao.

The current product direction is Ask Siargao: a Siargao-focused chatbot tour operator. Travelers paste or type a trip plan, then ask practical questions about accommodations, areas, restaurants, beaches, parties, transfers, clinics, scooter rentals, weather, and fit for their own requirements.

## Current Source Of Truth

- [PRD](PRD.md): chat-first product requirements.
- [TECH](TECH.md): technical architecture for the chatbot, trip memory, lazy fact acquisition, provider calls, and usage metering.
- [DATA_STRATEGY](DATA_STRATEGY.md): data pipeline logic for checking the DB first, fetching live provider data on demand, and normalizing useful facts back into the DB.
- [ASK_SIARGAO_POSITIONING](ASK_SIARGAO_POSITIONING.md): product positioning against ChatGPT and Claude, including differentiation principles and priority roadmap.
- [Chat Agent Runtime Reference](developer/reference/chat-agent-runtime.md): developer reference for extending the `/api/chat` agent runtime with backend tools, source summaries, provider-failure handling, and observability.
- [STARTUP_IDEA_LAB](STARTUP_IDEA_LAB.md): product positioning, pricing, validation, and go-to-market thesis.
- [LANDING_STYLE_REQUIREMENTS](LANDING_STYLE_REQUIREMENTS.md): current landing and chat-entry UX requirements.
- [COMPETITORS](COMPETITORS.md): market research and competitor observations.

## Historical Research

These files are useful research inputs, but they are not the current product source of truth:

- [ai-travel-concierge-proven-base](ai-travel-concierge-proven-base.md)
- [ai-travel-startup-ideas](ai-travel-startup-ideas.md)
- [deep-research-report](deep-research-report.md)

Some historical notes use the older trip-risk-audit framing. Use them as market context, not as implementation direction.
