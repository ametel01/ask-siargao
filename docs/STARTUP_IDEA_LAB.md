# Startup Thesis: Ask Siargao

## Underlying Instinct

Travelers already ask AI assistants and search engines practical trip questions. They do not only want inspiration. They want a confident local answer for their specific stay, dates, constraints, and current conditions.

The product should feel like a Siargao specialist who can answer anything about the island, not a form that produces a one-time risk report.

## Proven Base

| Proven behavior | What proves it | Product implication |
| --- | --- | --- |
| Travelers ask AI for trip advice | ChatGPT, Gemini, Perplexity, Google AI search behavior | Start with chat, not a form. |
| Travelers rely on local directories | SiargaoLocal, Siargao Finder, Siargao Vibes | Use area/category/entity data, but add reasoning and context. |
| Travelers trust reviews and maps | Google, Tripadvisor, booking platforms | Use live provider data where allowed and show freshness/confidence. |
| Travelers need local operators | Tour sites, scooter rentals, transfer providers | Redirect to providers instead of managing bookings. |
| Travelers care during the trip | weather, events, parties, clinics, transfers | Price around the stay window, not a monthly subscription. |

## Better Claim

The better claim is:

```text
Ask Siargao anything about your trip.
```

This is better than a generic AI travel planner because it is:

- destination-specific
- aware of current weather and live local data
- grounded in normalized facts
- relative to the user's accommodation and dates
- able to store useful facts for future travelers

## New Hook

The hook is not "get a report." The hook is:

```text
Paste your plan. Get local Siargao answers for the next two weeks.
```

Example prompts:

- "Is my place near Cloud 9 quiet enough for sleep?"
- "Where should we eat tonight near General Luna?"
- "Should we rent a scooter or use transfers?"
- "What beach is best today with this weather?"
- "Any parties worth going to this weekend?"
- "Where is the nearest clinic from my hotel?"

## Pricing Thesis

Use a trip pass, not a subscription.

Launch pricing:

- 10 free travel answers over seven days.
- USD 9.99 Siargao Trip Pass with 150 travel answers, valid for 14 days.

Why this is plausible:

- The average traveler stay is closer to a trip window than a recurring subscription.
- The user pays once for help during the stay.
- The price can absorb Stripe fees and bounded LLM/provider costs.
- Answer metering and internal provider cost circuits protect margin.

Weather, surf, Places, events, public evidence, and route reasoning are selected automatically and
do not have separate customer-facing limits.

## Free Hook

Free mode should provide enough value to prove competence:

- parse the trip prompt
- identify accommodation or area when possible
- show today's weather
- answer with the same evidence-aware behavior used by the paid product
- explain truthful freshness or provider-availability boundaries

Paywall trigger after the free answer allowance is used:

```text
You have used your free travel answers. Get 150 answers for your trip.
```

Do not frame the paywall as buying a static risk report. Frame it as unlocking a live local trip assistant.

## Distribution

Best early channels:

- Siargao Facebook and Reddit travel questions.
- Search pages for accommodation, area, quiet sleep, no scooter, family, weather, transfer, clinic, and party queries.
- Short demos showing one pasted trip prompt turning into useful local answers.
- Partner redirects from operators or accommodations later, clearly disclosed.
- AI answer-engine visibility through public pages only after the internal fact graph has useful allowed facts.

Priority query families:

- "Is [hotel] Siargao quiet?"
- "Siargao with kids where to stay"
- "General Luna best restaurants tonight"
- "Siargao airport to [hotel]"
- "Siargao no scooter where to stay"
- "Siargao weather today what to do"
- "Siargao parties this weekend"

## Retention Loop

Retention is tied to the trip:

- before arrival: accommodation, transfer, weather, and packing questions
- first day: orientation, food, scooter, cash, SIM, and beach questions
- during stay: weather-aware suggestions, events, parties, restaurants, clinics, and backup plans
- after useful answers: saved facts improve future trips

The long-term retention loop is destination expansion or future Siargao visits, but the MVP should focus on usefulness during one trip.

## Cheap Validation Plan

1. Replace the form-first landing page with a chat prompt.
2. Let users submit any Siargao question or trip plan.
3. Manually or semi-automatically answer the first 20 serious prompts.
4. Measure which questions repeat.
5. Add live Google Places and Open-Meteo calls only for repeated high-value intents.
6. Show the trip-pass paywall when live evidence is needed.
7. Track whether users pay or at least submit email/payment intent.

Continue if:

- users ask practical, specific follow-up questions
- more than 5 percent of qualified free users show paid intent
- live answers are meaningfully better than generic ChatGPT
- the system can reuse normalized facts across users
- average provider cost per paid trip stays far below the pass price

Kill or pivot if:

- users only want free generic itineraries
- the app cannot answer better than ChatGPT plus Google Maps
- provider costs exceed pricing without clear user value
- source restrictions prevent useful answers
- users do not return after the first answer

## Product Positioning

Use:

- "Ask Siargao anything about your trip."
- "Paste your plan. Get local answers before and during your stay."
- "Live weather, local places, transfers, beaches, parties, and practical help for Siargao."

Avoid:

- "Risk audit" as the main product frame.
- "Report" as the main paid artifact.
- "Generic AI trip planner."
- "Booking portal."
- "Cheapest hotel finder."

The product can redirect users to booking, maps, WhatsApp, restaurants, tours, and operators, but its job is independent local guidance.
