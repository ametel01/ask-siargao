# Startup Idea Lab: Siargao Trust Layer

This document translates the competitor analysis into a Proven Better New product map for the Siargao trip-audit product.

The core premise: travelers do not need another generic Siargao guide. They need confidence that their specific plan will work once real local constraints are considered.

## Underlying Instinct

Travelers already stitch together Siargao decisions from directories, reviews, booking pages, tour operators, social content, weather forecasts, and official fragments. The competitor landscape proves the behavior exists, but no player has converted that behavior into a source-aware, trip-specific risk decision.

The opportunity is not to become the biggest directory first. It is to become the trust layer that interprets fragmented local data against the user's actual plan.

A second opportunity is distribution through AI answer engines. Many younger travelers now ask ChatGPT, Claude, Gemini, Perplexity, and similar products before they search Google directly. The product should therefore publish source-backed public pages that are easy for agents to parse and cite, not just human-oriented SEO pages.

## Proven Base

| Competitor pattern | Who proves it | What is working | What we can copy |
| --- | --- | --- | --- |
| Searchable local directory | SiargaoLocal, Siargao Finder, Siargao Vibes | Users need structured discovery by area, category, and business type. | Category pages, area pages, business profiles, listing status, claim/update/report workflows. |
| Review and trust aggregation | SiargaoLocal, Tripadvisor-style behavior, booking platforms | Travelers lean on review volume, ratings, and repeated public sentiment. | Visible trust signals, review summaries, recurring complaint themes, provenance labels. |
| Practical local services | Siargao Finder | Siargao planning depends on operational categories, not just attractions. | Coverage for clinics, coast guard, transport, utilities, repair, supplies, ATMs, SIMs, and government offices. |
| Direct action buttons | Siargao Finder, Siargao Vibes | Users want to call, WhatsApp, navigate, save, and verify quickly. | Call, WhatsApp, directions, website, save, report, and "ask this business" actions. |
| Booking-grade tour detail | Siargao Island Hopping | Users understand date, pax, pickup, inclusions, exclusions, refund, and cancellation flows. | Audit inputs and evidence summaries should use similar operational detail. |
| Current local rhythm | Siargao Vibes | Events, nightlife, weather, and local timing affect trip quality. | "This week" signals, event windows, opening status, crowd/noise expectations. |
| Owner contribution loop | SiargaoLocal, Finder, Vibes | Local businesses are willing to claim, add, or update listings. | Verified update flow, owner-supplied facts, freshness badges, correction requests. |
| Compliance and transparency | Siargao Finder | Serious travel products need privacy, terms, AI, and data-use clarity. | Clear source policy, AI disclosure, data retention rules, and user-rights language. |
| Single-purpose paid conversion | Tour booking sites | Users pay when the outcome is specific, concrete, and timed. | One clear USD 9.99 audit product with a completion gate before payment. |

Copy the behavior patterns, not protected content or prohibited datasets. Several competitors explicitly restrict scraping, so the product should learn from their UX and market proof while building its own permitted data pipeline through official sources, public APIs, partnerships, user submissions, and licensed data.

## Better Claim

The better claim should be:

**"Before you book Siargao, see what can break in your specific plan."**

This is stronger than a directory, blog, booking page, or itinerary generator because it is:

- Specific to the user's dates, accommodation, route, constraints, and tolerance.
- Grounded in source-ranked evidence instead of generic AI advice.
- Paid only when the audit can be completed.
- Focused on decisions: book, change area, ask host, avoid date, add buffer, choose backup, or proceed.

## What We Should Copy

### Directory Mechanics

Copy category/location browsing from SiargaoLocal and Finder, but make it internal-first. The database should support accommodation resolution, transport checks, local service lookup, and evidence retrieval. Public directory pages can come later as SEO and acquisition surfaces.

Minimum copyable pieces:

- Area taxonomy.
- Category taxonomy.
- Listing detail pages.
- Contact/action fields.
- Claimed/verified/update-needed statuses.
- Report incorrect info.
- Add listing.
- Owner claim flow.

### Trust Signals

Copy the fact that users trust review volume, public reputation, and repeated complaint patterns. Improve it by separating:

- Official facts.
- Operator claims.
- Directory facts.
- User reviews.
- Social/forum signals.
- Weather/transport forecasts.
- LLM interpretation.

Each audit should show why a claim is trusted, not just what the model thinks.

### Booking Detail Language

Copy tour-booking detail structures from Siargao Island Hopping:

- Date sensitivity.
- Group size.
- Pickup/logistics.
- Inclusions and exclusions.
- Weather cancellation risk.
- Refund or rebooking caveats.
- Capacity or availability implications.

Use this structure for audits even when we are not selling the booking.

### Local Freshness

Copy Siargao Vibes' strength around current local rhythm. Siargao decisions can depend on short-lived signals: events, surf competitions, roadworks, ferry disruption, weather windows, power/internet outages, and venue status.

The audit should distinguish stable facts from freshness-sensitive facts.

### Operational Categories

Copy Finder's practical coverage. Trip risk is often decided by non-tourist categories:

- Hospital and clinic access.
- Pharmacy access.
- ATMs and cash needs.
- Coast guard and ferry offices.
- Scooter rental and repair.
- Laundry.
- Grocery.
- Coworking and internet.
- Family supplies.
- Airport and port transfer options.

These categories create audit defensibility beyond "nice place to stay."

## Improvements We Can Add

| Improvement | Why it matters | Product expression |
| --- | --- | --- |
| Trip-specific risk scoring | Competitors show facts; users still interpret them manually. | Score accommodation, arrival, weather, transport, noise, remoteness, and constraint fit for the exact trip. |
| Completion gate before payment | Avoid charging for weak or incomplete audits. | Run source coverage checks before Stripe Checkout. Charge only when enough evidence exists. |
| Evidence-first output | AI travel tools are hard to trust without sources. | Every recommendation links to evidence IDs, source type, freshness, and confidence. |
| Source hierarchy | Official, operator, directory, social, and review data should not carry equal weight. | Display "official", "verified local", "operator claim", "review signal", "unverified" labels. |
| Conflict detection | Travel data is often inconsistent. | Surface conflicts like different opening hours, mismatched location, outdated ferry info, or review complaints contradicting listing copy. |
| Accommodation resolver | User should paste a stay name instead of filling forms. | Resolve pasted accommodation against permitted sources, aliases, map data, and listing databases. |
| Constraint-aware evaluation | A good choice for surfers may be bad for families or remote workers. | Ask for one top constraint, then evaluate against it. |
| Reviewer LLM pass | Primary LLM can overstate confidence. | Separate fresh-context reviewer validates evidence use, missing data, and risk language. |
| Host/operator question generator | Many risks are best resolved by asking the business directly. | Generate concise WhatsApp questions tailored to unresolved risks. |
| Pre-arrival refresh | Some risks change after purchase. | Offer a 7-day and 48-hour refresh for weather, transport, events, and known disruptions. |
| Staleness policy | Stale listings are a core weakness in local travel. | Mark stale fields and trigger targeted refresh when cache is older than threshold. |

## New Feature Wedges

| Rank | Idea | Proven base | Better claim | New hook | Distribution | Retention | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Siargao Trip Risk Audit | Reviews, directories, booking research, local guide searches | "Know what can break before you book." | USD 9.99 paid audit with no-charge incomplete gate and reviewer LLM. | SEO for high-intent risk queries, travel groups, accommodation-name search pages. | Pre-arrival refresh, shareable report, future destinations. | Build first. |
| 2 | Accommodation Reality Check | Users compare stays across Airbnb/Agoda/Booking/Google/reviews | "Is this stay actually right for your trip?" | Paste accommodation name; system resolves listing and audits noise, access, internet, transport, review complaints, and area fit. | Accommodation-specific landing pages and free preview risks. | Users return before booking each stay. | Strongest sub-wedge. |
| 3 | Arrival Logistics Checker | Ferry, flight, airport transfer, and weather uncertainty | "Can you actually arrive smoothly on this date?" | Route-aware checks for late arrivals, ferry windows, transfer buffers, weather, cash/SIM needs. | Search queries around Cebu/Manila/Surigao to Siargao, ferry schedules, late arrivals. | 48-hour refresh before arrival. | High practical value. |
| 4 | This Week In Siargao Risk Layer | Events and local guides prove current rhythm matters | "What will affect your trip this week?" | Event, crowd, surf, weather, closure, and noise watchlist. | Weekly SEO/social posts, newsletter, group sharing. | Weekly local usage and pre-trip updates. | Good acquisition layer. |
| 5 | Operator Trust Snapshot | Tour booking pages and reviews prove operator comparison | "Is this tour/operator a safe bet?" | Accreditation, review themes, cancellation terms, weather suitability, pickup clarity. | Operator-name and tour-name search pages. | Repeat for multiple tours. | Useful after audit core. |
| 6 | No-Scooter / Family / Remote-Work Fit Score | Segment depth is weak in competitor content | "Will this plan work for your actual constraints?" | Constraint packs for families, non-drivers, remote workers, quiet sleepers, surfers, accessibility needs. | Long-tail SEO and community posts. | Repeat planning across stay/tour choices. | Strong differentiator. |
| 7 | Local Safety Net Map | Finder proves practical services matter | "Know your backup options before you arrive." | Personalized list of clinics, pharmacies, ATMs, repairs, transport, and emergency contacts near the stay. | Included in audit, shareable checklist. | Used during the trip. | Good add-on. |
| 8 | Stale Claim Watchlist | Local data decays quickly | "This travel claim may be outdated." | Detect old, conflicting, or unsupported claims in guides/listings. | Browser-extension-like future, SEO snippets, audit evidence labels. | Ongoing data moat. | Later data product. |
| 9 | Host Question Pack | Travelers already message hosts/operators manually | "Ask the right questions before you pay." | One-tap WhatsApp message based on unresolved evidence gaps. | Audit output and accommodation pages. | Practical in every audit. | Cheap and useful. |
| 10 | Independent Siargao Trust Badge | Businesses want credibility and listing claims | "Verified enough for risk-aware travelers." | Businesses submit evidence; users see freshness and verification. | Business-owner acquisition. | Recurring business updates. | Do not lead with this; could bias independence. |

## Proven vs Assumed

### Proven

- Travelers use Siargao-specific directories and guides.
- Review volume and public reputation matter.
- Users need area and category browsing.
- Tour booking behavior already depends on dates, pax, pickup, inclusions, exclusions, and cancellation terms.
- Current local rhythm matters: events, nightlife, weather, surf, and opening status influence trip quality.
- Official information is fragmented.
- Local businesses have reason to claim and update listings.

### Assumed

- Users will pay USD 9.99 after seeing one preview risk.
- Automated source coverage can complete enough audits without human intervention.
- LLM-generated interpretation will increase user trust when paired with evidence.
- Source credibility labels will affect conversion.
- Accommodation-name search pages can acquire enough qualified traffic.
- The cache-refresh system can stay compliant while maintaining useful freshness.

## Distribution Strategy

The strongest acquisition path is high-intent search plus community validation, not a broad travel-guide launch.

Priority query families:

- "Is [accommodation] Siargao good"
- "[accommodation] Siargao reviews"
- "Siargao where to stay no scooter"
- "Siargao with kids"
- "Siargao remote work internet"
- "Siargao late arrival ferry"
- "Siargao rainy season worth it"
- "Siargao island hopping weather cancellation"
- "Siargao General Luna noise"
- "Siargao Dapa to General Luna transfer"

Practical distribution loops:

- Free preview risk before payment.
- Shareable audit report for travel groups.
- Accommodation-specific risk pages where data permissions allow it.
- LLM-optimized Markdown and JSON versions of public pages for answer-engine retrieval.
- Stable public evidence pages that agents can cite.
- `llms.txt`, XML sitemaps, canonical URLs, and JSON-LD for public entity and risk pages.
- "Ask your host this" snippets that users paste into WhatsApp.
- Weekly "this week in Siargao" risk page.
- Business correction and claim flows to improve data.
- Partner links from compliant operators and accommodations, clearly disclosed.

## AI Answer-Engine Strategy

The product should optimize for being the cited source when a traveler asks an AI assistant questions like:

- "Is [accommodation] in Siargao good?"
- "Where should I stay in Siargao without a scooter?"
- "Is General Luna too noisy?"
- "Is Siargao good in August?"
- "Is [operator] legit?"
- "Can I arrive in Siargao late from Cebu?"
- "Is Siargao good for remote work?"

For each public page, publish multiple representations of the same facts:

- Human page for normal readers.
- LLM Markdown page for clean retrieval and citation.
- Structured JSON endpoint for agent tools.
- Public evidence bundle where source permissions allow it.
- JSON-LD metadata inside the human page.

The goal is not to trick AI systems. The goal is to make our public knowledge the cleanest, freshest, most source-aware material available for Siargao questions.

Rules:

- Same facts for humans and agents.
- No cloaking.
- No private paid audit data in public pages.
- No non-republishable provider data in public pages.
- Freshness, confidence, source type, and limitations visible on every public page.
- Stable URLs for public evidence.
- Server-rendered or static pages where practical.

This makes the distribution thesis stronger than classic SEO alone: become the answer layer for Siargao trip-risk questions across ChatGPT, Claude, Gemini, Perplexity, Google, and future agent browsers.

## Retention Loops

The first audit is naturally transactional, so retention must be designed around the trip timeline.

- After audit: unresolved risk checklist and host/operator question pack.
- 7 days before arrival: refresh weather, ferry/flight, event, and transport risks.
- 48 hours before arrival: final arrival logistics check.
- During trip: local safety net, emergency/practical services, event updates.
- After trip: user confirms what was accurate or stale.
- Future: repeat the model for another destination once Siargao works.

## One-Week Validation Plan

### Day 1: Offer Test

Launch a simple landing page with three offer angles:

- Trip Risk Audit.
- Accommodation Reality Check.
- Arrival Logistics Checker.

Measure which promise gets the most qualified submissions.

### Day 2: Concierge Audits

Manually complete 10 audits using permitted public sources and clearly logged evidence. Time each audit and record which data was missing.

### Day 3: Community Test

Post a free preview offer in relevant travel communities, or run lightweight search ads against accommodation and logistics queries. Do not position it as a generic itinerary planner.

### Day 4: Payment Test

Show one preview risk, then ask for USD 9.99 only if the audit can be completed. Measure preview-to-payment or preview-to-email conversion.

### Day 5: Trust Test

Test two report formats:

- Concise decision-first report.
- Evidence-heavy report with source labels.

Interview users on which one they trust enough to act on.

### Day 6: Data Test

Build a small accommodation resolver set for 25 popular stays. Track match rate, ambiguity rate, source coverage, and freshness gaps.

### Day 7: Kill Or Continue

Continue only if the signal shows real decision value, not curiosity.

Continue thresholds:

- 30 or more qualified submissions.
- At least 5 percent paid intent or payment conversion at USD 9.99.
- At least 3 users say the audit would change where they stay, when they arrive, or what they ask before paying.
- Manual audit time trends below 30 minutes with a clear path to automation.
- Accommodation resolver succeeds for at least 70 percent of tested names.
- At least 10 high-intent public pages can be produced with permitted, source-backed, agent-readable facts.
- At least one AI answer engine can retrieve or cite a public page when prompted with a matching Siargao question during manual testing.

Kill or pivot thresholds:

- Users only want a free itinerary.
- Users do not care about evidence or risk.
- Too many audits cannot be completed with permitted data.
- Manual audit time stays too high with no obvious automation path.
- The output cannot make a clear recommendation beyond generic travel advice.
- Public pages cannot expose enough useful facts without violating source permissions or publishing weak claims.

## Product Positioning

Recommended positioning:

**Not a guide. Not a booking portal. A trust layer for Siargao travel decisions.**

Short landing-page variants:

- "Before you book Siargao, see what can break."
- "Paste your stay. Get a source-backed risk audit."
- "Know the arrival, accommodation, weather, and local risks before you pay."
- "One independent Siargao audit. USD 9.99. Charged only when complete."

Avoid positioning as:

- Generic AI trip planner.
- Cheapest booking finder.
- Official tourism portal.
- Full public review platform.
- Affiliate-led recommendation engine.

## Immediate Recommendation

Keep the USD 9.99 Trip Risk Audit as the primary wedge, but tighten the first product around accommodation and arrival feasibility. That is where competitor behavior is most proven and where the product can be meaningfully better.

Build sequence:

1. Accommodation Reality Check.
2. Arrival Logistics Checker.
3. Full Trip Risk Audit report.
4. Pre-arrival refresh.
5. Local safety net add-on.
6. Public SEO and AI-agent pages from permitted, internally verified data.

This avoids competing head-on with established directories while still copying the behaviors that make them useful: searchable local facts, reviews, direct actions, practical categories, booking-grade detail, and current local rhythm.
