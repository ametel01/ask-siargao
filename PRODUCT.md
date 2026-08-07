# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Ask Siargao serves travelers who are planning a Siargao trip or are already on the island and need
practical decisions about stays, itineraries, surf sessions, transport, weather, and disruptions.
Their job is to turn their real constraints and current circumstances into a workable next move.

## Product Purpose

Ask Siargao helps travelers reality-check a proposed choice or plan before they commit to it. It
combines traveler context, request-time evidence, and governed local knowledge to return a clear
keep, change, avoid, or needs-confirmation decision. Success means the traveler can make or revise
the plan with a concrete next action and an honest understanding of material uncertainty.

## Positioning

Ask Siargao is not generic travel chat. Its distinct mechanism is constraint-aware local judgment:
it evaluates a named stay, supplied itinerary, immediate plan, surf session, or disruption against
the traveler's circumstances and governed evidence, then makes a bounded decision instead of only
listing possibilities.

## Operating Context

- Travelers may use the product before booking, while assembling an itinerary, or during a trip
  when weather, transport, closures, illness, or other disruptions change the plan.
- The primary interaction is an explicitly submitted chat request. Opening the app does not begin
  a Reality Check or imply ongoing monitoring.
- Travelers can provide current-trip context and durable preferences, save selected recommendation
  or itinerary artifacts, and share only selected saved items through a public link.
- Anonymous use is supported; signing in enables owner-scoped history, profiles, saved planning,
  ratings, privacy controls, and Trip Pass access.

## Capabilities and Constraints

- Reality Checks cover accommodations, traveler-supplied itineraries, immediate plans, surf
  sessions, and disruption recovery.
- Decisions use the normalized outcomes `keep`, `change`, `avoid`, and `needs_confirmation`.
- The product can draw on governed Siargao knowledge and request-time Places, weather, marine,
  tide, event, route, and public-web evidence when the request calls for it.
- Evidence ordering, source eligibility, freshness, field masks, retention rules, and public versus
  private boundaries are product constraints, not implementation details to bypass.
- Exact surf-break safety, live availability, intervention, booking, and future confirmation must
  never be guaranteed.
- Provider failure or insufficient evidence must produce an honest bounded fallback rather than a
  fabricated fact or overconfident decision.
- Traveler privacy is mandatory: public or persisted artifacts must not expose exact coordinates,
  raw provider payloads, private source observations, secret tokens, or disallowed personal data.
- The current commercial offer is a seven-day free window with 10 travel answers and an optional
  14-day Siargao Trip Pass with 150 travel answers, subject to the server-owned product catalog and
  verified payment activation.

## Brand Commitments

- Preserve the name **Ask Siargao** and the existing palm mark at
  `public/ask_siargao_palm_icon.svg`.
- Use a direct, practical, traveler-centered voice.
- Be explicit and useful about material uncertainty without exposing internal tooling mechanics.
- Never fabricate local facts, availability, testimonials, customer claims, or safety guarantees.

## Evidence on Hand

- The working application contains traveler-facing landing, chat, trip-context, saved-plan,
  sharing, account, Trip Pass, public-knowledge, and Reality Check surfaces.
- `README.md` and `documentation/developer/` record the implemented product boundaries, evidence
  lifecycle, routes, privacy rules, and Reality Check contract.
- The repository includes governed local-data and provider pipelines plus synthetic fixtures for
  development and QA. Synthetic fixtures are not customer proof.
- Existing brand assets include the palm mark and Siargao imagery under `public/`.
- No confirmed testimonials, customer logos, case studies, press claims, or performance benchmarks
  are on hand; future work must not invent them.

## Product Principles

1. **Decide from the traveler's real constraints.** Recommendations should reflect who is
   traveling, where they are, how they move, and what the current plan requires.
2. **Give a usable next move.** Prefer a bounded decision and concrete action over a generic list of
   options.
3. **Earn confidence with governed evidence.** Use current and local evidence when it materially
   affects the answer, while preserving its source, freshness, and privacy boundaries.
4. **Make uncertainty operational.** When evidence is weak or unavailable, explain the practical
   consequence and provide a truthful fallback.
5. **Protect traveler trust.** Keep private context owner-scoped, reveal only selected public
   artifacts, and never imply capabilities the product does not have.
