# PRD: Ask Siargao

## Problem Statement

Travelers planning a Siargao trip already use ChatGPT, Google Maps, booking sites, reviews, blogs, Facebook groups, and local recommendations. The problem is not a lack of generic travel inspiration. The problem is that travelers cannot easily turn fragmented local information into a reliable answer for their actual stay.

The product should answer practical questions such as:

- Will this accommodation be quiet enough to sleep?
- Is this place good for a family?
- What parties or events should I go to during my dates?
- What is tonight's actual General Luna party route, not just which bars are
  listed on Google Maps?
- What are the best restaurants, beaches, clinics, scooter rentals, and transfer options near me?
- How do I get from the airport or port to my accommodation?
- How does today's weather change the plan?

Ask Siargao should become a specialized chatbot tour operator for Siargao. It should feel like asking a local operator who knows the island, has current data, does not manage bookings directly, and can redirect travelers to relevant places or providers when useful.

## Product Direction

Build Ask Siargao as a chat-first Siargao assistant. The user starts by pasting a natural-language trip plan, accommodation name, listing link, or question. The assistant extracts trip context, checks existing internal facts, fetches live provider data only when needed, stores useful normalized facts, and answers with freshness and confidence.

Risk remains part of the product, but it is not the product frame. The product frame is:

```text
Ask Siargao anything about your trip.
```

The first paid product should be a one-time trip pass for a typical two-week stay, not a recurring SaaS subscription.

Launch offer:

- 10 free Siargao travel answers over seven days.
- USD 9.99 Siargao Trip Pass with 150 travel answers, valid for 14 days.

The product has one interaction mode: ask a Siargao travel question. The system automatically checks
weather, surf, Places, events, or public sources when the answer needs current evidence; travelers do
not choose or purchase a separate deep-search mode.

## Core User Stories

1. As a traveler, I want to paste my trip plan in one chat box, so that I do not have to fill a long audit form.
2. As a traveler, I want the assistant to remember my accommodation, dates, traveler type, budget, and constraints, so that follow-up questions stay contextual.
3. As a traveler, I want to ask whether my accommodation is quiet, family-friendly, remote-work friendly, or convenient, so that I can decide whether to keep or change it.
4. As a traveler, I want restaurants, beaches, parties, clinics, scooter rentals, and transfer advice relative to where I am staying, so that recommendations are practical.
5. As a traveler, I want today's weather and forecast to affect recommendations, so that the answer reflects current conditions.
6. As a traveler, I want the assistant to explain freshness and confidence, so that I know when a recommendation is strong or uncertain.
7. As a traveler, I want a useful free preview, so that I can judge the product before paying.
8. As a paid traveler, I want enough travel answers for a two-week stay, so that I can keep asking contextual questions throughout the trip.
9. As a traveler, I want redirects to relevant businesses, maps, booking pages, or contact methods, so that I can act on recommendations.
10. As an operator, I want live provider results normalized into reusable facts, so that the product improves from real user demand.
11. As an operator, I want rate limits on expensive provider calls, so that a paid pass stays profitable.
12. As an operator, I want source-use rules enforced before storage or display, so that Google Places and other provider data are handled safely.

## Free And Paid Experience

Free mode should:

- Parse a trip prompt.
- Detect accommodation or area when possible.
- Give the same evidence-aware answer experience for up to 10 answers over seven days.
- Trigger the paywall after the free travel-answer allowance is used.

Paid mode should:

- Persist trip memory for the pass duration.
- Allow contextual follow-up chat.
- Include 150 travel answers over 14 days.
- Use current evidence when internal facts are missing or stale and policy allows it.
- Normalize useful observations into the fact database.
- Provide local recommendations with confidence and freshness.
- Explain when an answer is based on cached facts versus newly fetched data.

Weather, Places, surf, events, public research, and route reasoning do not have separate
customer-facing allowances.

## MVP Question Scope

The MVP should support:

- Accommodation quiet-sleep fit.
- Family fit.
- Nearby restaurants.
- Nearby beaches.
- Nearby clinics or pharmacies.
- Airport or port transfer guidance.
- Scooter rental recommendations.
- Today's weather and short-term forecast.
- Event-backed nightlife routes when data is available, including warm-up,
  main-party, late-option, and softer-option suggestions with source freshness
  boundaries.

The assistant should work first for General Luna, Cloud 9, Malinao, and common airport or port arrival flows.

## Product Workflow

```text
user starts chat
  -> assistant extracts trip context
  -> system resolves accommodation or area
  -> system classifies time-bound intents such as tonight, nearby, open now, and party route
  -> system checks fresh facts in DB
  -> system fetches provider data when facts are missing or stale
  -> provider observations are normalized into facts
  -> answer is generated from bounded facts and evidence summaries
  -> usage meters are updated
```

The LLM can classify intent and draft answers, but deterministic code owns provider policy, rate
limits, freshness rules, cost circuits, travel-answer settlement, and storage decisions.

## Data Policy

Use permitted sources only. Do not scrape prohibited sources. Do not build a raw mirror of Google Places, booking sites, or local directories.

For nightlife and event answers, use approved event and venue sources in priority
order: official venue pages, local event directories, official public venue
social pages where allowed, local guides, community signals as low-confidence
context, Google Places for venue enrichment, and weather for route conditions.
Do not treat Google Places open-now status as proof of tonight's event schedule.

Store:

- User trip memory.
- Provider IDs where allowed, such as Google Place IDs.
- Normalized entities.
- Derived facts with freshness, confidence, source, and reuse scope.
- Short-lived source observations where provider terms allow.

Avoid storing:

- Raw provider payloads indefinitely when terms do not allow it.
- Raw review text as a durable reusable corpus unless rights are clear.
- Private user trip details in public pages or public APIs.

## Success Metrics

Track:

- Free chat start rate.
- Trip-context extraction success rate.
- Accommodation or area resolution success rate.
- Free-to-paid conversion.
- Paid questions per trip.
- Live refreshes per paid trip.
- Cost per paid trip.
- Provider error rate.
- Cached-answer rate after normalization.
- User-rated answer usefulness.
- Repeat usage during the trip.

## Out Of Scope For MVP

- Managing bookings directly.
- Commission-first recommendations.
- Full public review platform.
- Full island-wide directory coverage before demand proves it.
- Generic itinerary generation detached from Siargao facts.
- Scraping Agoda, Booking.com, Airbnb, or local directories without permission.
- Guaranteeing opening hours, prices, weather, safety, or availability.
- Native mobile apps.
- Multi-destination support.
