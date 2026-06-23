# PRD: Siargao Trip Risk Audit

## Problem Statement

Travelers planning a Siargao trip can easily get a generic itinerary from ChatGPT, Gemini, blogs, booking platforms, or social media, but they still lack confidence that the plan is feasible, current, and matched to their constraints. The risky parts are not inspiration; they are logistics, weather, area fit, accommodation reality, internet and power, transport, cash access, health access, admin details, closures, fees, accreditation, and current local events.

The Siargao information market is fragmented. There is no dominant official Siargao visitor portal, official information is spread across DOT, provincial, municipal, transport, and social channels, and several discoverable local sites show weak maintenance, stale policy content, thin disclosure, or templated SEO-style content. Some trusted operator signals also live outside owned websites, especially on Tripadvisor, Facebook, Instagram, booking platforms, and direct operator pages.

Search behavior is also shifting. Many younger travelers do not begin with Google search results; they ask ChatGPT, Claude, Gemini, Perplexity, or other AI search/answer products. If the platform is not easy for AI agents to retrieve, parse, cite, and trust, it may be invisible at the exact moment the traveler asks whether a Siargao plan, accommodation, area, or operator is a good choice.

The user wants a production-grade application that can automatically audit a Siargao trip plan, cite its evidence, score source credibility, make uncertainty visible, and charge only when the system can complete the audit to the promised standard.

## Solution

Build a mobile-first, editorially independent Siargao trust and logistics platform whose first monetized workflow is a Siargao Trip Risk Audit. A traveler enters travel dates or month, origin or arrival route, stay area or accommodation name, and their top constraint. The system resolves the trip context using permitted data sources, checks whether a full audit can be completed, shows one free preview risk, and then charges USD 9.99 for the full report only when the completeness gate passes.

The full audit returns a green/yellow/red trip risk rating, top risks, evidence-backed recommendations, source-quality notes, freshness and confidence notes, and practical fixes. Deterministic code handles retrieval, source policy, source credibility, cache freshness, matching, evidence IDs, payment gating, and job states. An LLM handles interpretation, tradeoff evaluation, risk ranking, and report writing through controlled read-only retrieval tools. A separate reviewer LLM checks the generated report before publication.

The larger platform strategy is to become the source-aware layer over fragmented Siargao travel information: official/provincial sources for rules and accreditation, local directories for practical texture, booking/review platforms for inventory and traveler sentiment, operator channels for activity-specific trust signals, and local verified records for facts that public websites do not maintain well.

The public knowledge strategy is AI-agent-first. Every public entity, area, route, operator, guide, and risk page should expose a human-readable page plus an LLM-optimized citation surface using the same underlying facts. The goal is to be the easiest trustworthy source for ChatGPT, Claude, Gemini, Perplexity, and other answer engines to cite when users ask Siargao-specific planning questions.

## User Stories

1. As a Siargao traveler, I want to submit my travel month or dates, so that the audit can evaluate weather, seasonality, and logistics risk.
2. As a Siargao traveler, I want to submit my origin or arrival route, so that the audit can evaluate transfer feasibility.
3. As a Siargao traveler, I want to submit an accommodation name, so that the system can try to resolve and assess the specific place I am considering.
4. As a Siargao traveler, I want to submit a stay area when I do not have an accommodation yet, so that I can still get an area-fit audit.
5. As a Siargao traveler, I want to name my top constraint, so that the audit focuses on what matters most to my trip.
6. As a Siargao traveler, I want to choose my risk tolerance, so that the advice is calibrated to relaxed, balanced, or low-risk travel.
7. As a remote worker, I want the audit to evaluate internet and power risk, so that I can avoid places that will break work calls.
8. As a family traveler, I want the audit to evaluate kids and family constraints, so that the plan is realistic for children.
9. As a surfer, I want the audit to evaluate seasonality and location fit for surfing, so that I can avoid poor timing or inconvenient areas.
10. As a traveler who needs quiet sleep, I want the audit to evaluate area and accommodation noise risk, so that I can avoid staying in the wrong zone.
11. As a budget-sensitive traveler, I want the audit to flag hidden cost risks, so that I can avoid avoidable transport or booking surprises.
12. As a traveler arriving late, I want the audit to evaluate timing risk, so that I know whether the final leg is realistic.
13. As a traveler who dislikes scooters or rough transport, I want the audit to account for transport comfort, so that the plan fits how I actually travel.
14. As a traveler with medical concerns, I want the audit to evaluate medical access, so that I understand clinic or hospital proximity risk.
15. As a traveler, I want one free preview risk, so that I can judge whether the audit is useful before paying.
16. As a traveler, I want the system to avoid charging me if it cannot complete the audit, so that I do not pay for an incomplete result.
17. As a traveler, I want the system to explain why an audit cannot be completed, so that I know what information is missing.
18. As a traveler, I want to provide more accommodation evidence when matching fails, so that the system has another chance to complete the audit.
19. As a traveler, I want to pay a single USD 9.99 price for the full audit, so that pricing is simple and predictable.
20. As a traveler, I want payment to happen through a trusted checkout, so that I can pay safely.
21. As a traveler, I want to see a processing status after payment, so that I know the audit is being generated.
22. As a traveler, I want a green/yellow/red risk rating, so that I can quickly understand the overall trip risk.
23. As a traveler, I want the top three risks called out first, so that I can focus on the most important fixes.
24. As a traveler, I want a full risk table, so that I can scan all relevant risk categories.
25. As a traveler, I want every important factual claim to cite evidence, so that I can trust the recommendation.
26. As a traveler, I want freshness and confidence labels, so that I know which claims are current and which are uncertain.
27. As a traveler, I want recommended fixes for each major risk, so that I can act on the report.
28. As a traveler, I want accommodation questions to ask before booking, so that I can verify claims directly with the host.
29. As a traveler, I want the report to make limitations explicit, so that I do not mistake low-confidence notes for verified facts.
30. As a traveler, I want the audit to avoid generic itinerary filler, so that the report stays focused on feasibility and risk.
31. As an operator, I want provider adapters to enforce allowed-use policy, so that prohibited scraping does not enter the product.
32. As an operator, I want a cache of normalized facts with provenance, so that the product can reuse evidence safely.
33. As an operator, I want stale data to refresh only through permitted sources, so that the system remains compliant.
34. As an operator, I want accommodation resolution confidence scores, so that payment is blocked when the match is weak.
35. As an operator, I want critical facts to block payment when they cannot be resolved, so that paid audits meet the promised standard.
36. As an operator, I want provider errors to be visible, so that I can diagnose missing or stale data.
37. As an operator, I want audit jobs to preserve state, so that failures can be retried or explained.
38. As an operator, I want structured LLM tool-call logs, so that I can debug cost, evidence usage, and report quality.
39. As an operator, I want reviewer LLM results stored separately, so that I can see why a report was revised or blocked.
40. As an operator, I want observability on preview-to-payment conversion, so that I can validate whether users will pay.
41. As an operator, I want observability on accommodation resolution success rate, so that I can prioritize provider integrations and local data seeding.
42. As an operator, I want observability on LLM cost per audit, so that the USD 9.99 price remains economically viable.
43. As an operator, I want an admin view for blocked audits, so that I can inspect failures without reading raw logs.
44. As a developer, I want destination-specific rules isolated, so that other destinations can be added later.
45. As a developer, I want provider adapters isolated, so that Agoda, Tripadvisor/Terra, weather, maps, and local data can be added or disabled independently.
46. As a developer, I want deterministic validation around LLM output, so that the product does not rely only on model judgment for structural correctness.
47. As a developer, I want centralized Panda CSS tokens and recipes, so that the UI remains consistent across pages.
48. As a developer, I want external behavior tested at the audit lifecycle level, so that tests protect the product promise instead of implementation details.
49. As a Siargao traveler, I want official and provincial sources cross-checked when policy, fees, accreditation, or transport rules are mentioned, so that stale commercial content does not mislead me.
50. As a Siargao traveler, I want the audit to distinguish official facts, local directory facts, operator claims, booking-platform data, and traveler sentiment, so that I understand what kind of evidence supports each recommendation.
51. As a Siargao traveler, I want live or recent transport and event signals considered near my arrival date, so that closures, ferry changes, surf events, nightlife events, or crowding do not surprise me.
52. As a Siargao traveler, I want activity and tour operators checked against review and social proof where permitted, so that I do not rely only on polished operator copy.
53. As a Siargao traveler, I want sustainability and environmental-fee considerations surfaced when relevant, so that I understand local rules and responsible-travel constraints.
54. As an accessibility-conscious traveler, I want accessibility limitations and source gaps surfaced clearly, so that the audit does not overpromise on vague or unverified accessibility claims.
55. As a family traveler, I want family-specific recommendations to use stronger evidence than generic travel-blog claims, so that the advice is practical for children.
56. As an operator, I want every source to have a credibility profile, so that low-quality or stale sources cannot support high-confidence claims.
57. As an operator, I want official-source conflicts to be detected, so that older commercial pages do not override current government, transport, or accreditation sources.
58. As an operator, I want non-website trust signals captured where permitted, so that strong operators with Tripadvisor, Facebook, Instagram, or marketplace traction are not invisible.
59. As an operator, I want the system to track known weak sources, so that templated, stale, or thinly disclosed pages are treated cautiously.
60. As a developer, I want source credibility separated from fact confidence, so that a true-looking claim from a weak source does not get treated the same as a verified claim from an official or directly confirmed source.
61. As a developer, I want source discovery and audit generation separated, so that the product can later publish free trusted guides without changing the paid audit workflow.
62. As a developer, I want the PRD to preserve the $9.99 audit as the first workflow, so that the larger platform opportunity does not expand v1 beyond validation scope.
63. As a traveler asking ChatGPT, Claude, Gemini, Perplexity, or another AI answer engine about Siargao, I want those systems to find clear source-backed pages from this product, so that I can discover trustworthy trip-risk information without starting from Google.
64. As a traveler, I want public accommodation, area, route, operator, and risk pages to expose freshness, confidence, source type, and limitations, so that an AI-generated answer does not flatten uncertainty into unsupported advice.
65. As an operator, I want every public page to have an LLM-optimized Markdown and structured JSON version, so that AI crawlers and retrieval tools can cite stable, concise, machine-readable facts.
66. As an operator, I want public agent-readable pages to use the same factual claims as the human page, so that the system avoids cloaking, misleading AI crawlers, or publishing unsupported parallel content.
67. As an operator, I want an `llms.txt` file, XML sitemap, canonical URLs, and JSON-LD metadata, so that search engines and AI agents can discover the highest-quality public pages.
68. As an operator, I want AI-search referrals and cited-page visits tracked where possible, so that I can measure whether answer engines are becoming an acquisition channel.
69. As a developer, I want a public read-only API for entity summaries, evidence bundles, and risk previews, so that approved agent integrations can retrieve facts without scraping human UI.
70. As a developer, I want agent-readable pages excluded from private paid reports and user trip details, so that public AI visibility does not leak user-specific audit data.

## Implementation Decisions

- Build a production web application with Next.js App Router and TypeScript.
- Use Panda CSS for centralized styling. Do not use Tailwind CSS.
- Use shadcn/ui component patterns and generated local component code where useful, especially for forms, dialogs, accordions, sheets, tabs, buttons, cards, badges, and menus.
- Use Ark UI or Radix primitives where accessible headless UI primitives are useful.
- Treat shadcn as a component blueprint layer, not the styling authority. Convert or adapt generated shadcn styling to Panda CSS recipes and tokens before production use.
- Use Postgres as the system of record.
- Use Drizzle or Prisma for database access. The exact ORM remains open.
- Use Stripe Checkout for the USD 9.99 payment flow.
- Treat verified Stripe webhook events as the source of truth for paid report unlocks.
- Use Redis-backed jobs, Trigger.dev, Inngest, or an equivalent worker system for asynchronous audit work. The exact job runner remains open.
- Use OpenAI Responses API or OpenAI Agents SDK for TypeScript for the audit generator and reviewer LLM flows.
- Do not build a generic chatbot or generic itinerary planner as the core product.
- Treat the product as a Siargao trust and logistics platform whose first monetized workflow is the Trip Risk Audit.
- Treat AI answer-engine visibility as a first-class distribution surface alongside traditional SEO.
- Keep the first destination scope to Siargao.
- Keep architecture destination-agnostic where practical by isolating destination rules and local facts.
- Support any stay length.
- Require a minimum viable intake of dates or travel month, arrival route or origin, planned stay area or accommodation name, and top user constraint.
- Support optional intake fields for accommodation platform/link, traveler type, group size, children, remote work, surfing, quiet sleep, budget sensitivity, transport comfort, medical access, food/accessibility constraints, and risk tolerance.
- Ask for accommodation name first, then resolve it through permitted APIs or local data.
- If accommodation resolution fails, request extra user evidence such as listing link, listing text, screenshots, exact address, or host-provided details.
- Allow payment only after an audit completeness gate passes.
- The completeness gate must evaluate dates/month, arrival route/origin, stay area, accommodation identity or explicit no-accommodation case, weather/seasonality, core logistics, and at least one user-stated top constraint.
- If an accommodation is named, the match must meet a configured confidence threshold before payment.
- Show one free preview risk before payment.
- Block payment or keep the audit unpaid when critical inputs or critical facts cannot be resolved.
- Evaluate every audit against arrival/departure logistics, weather/seasonality, area fit, internet/power, on-island transport, cash/SIM/basic services, health/safety/admin, official/accreditation status where relevant, and stale-policy risk.
- Add optional modules for remote work, family/kids, surfing, quiet sleep, budget, arrival timing, transport comfort, medical access, accessibility, nightlife, and food restrictions.
- Add optional modules for sustainability, environmental/local fees, live events, closures, and operator trust signals when relevant to the trip.
- Rank risks by impact, likelihood, fixability, and traveler relevance.
- Every risk should include what might break, why it matters, evidence, freshness/confidence, and a recommended fix.
- Use permitted data only: official APIs, licensed feeds, public sources whose terms allow automated collection, user-submitted details, local verified records, and direct partner or host data.
- Do not use ToS-risky scraping for core product data.
- Publish public pages only from facts that are allowed to be republished publicly.
- For each public page, provide a human page, an LLM-optimized Markdown route, a structured JSON route, JSON-LD metadata, a canonical URL, and sitemap coverage.
- Maintain an `llms.txt` file that points agents to the most useful public indexes, entity pages, evidence pages, and API documentation.
- Do not use LLM-optimized pages for cloaking. Agent-readable content must match the human-visible factual claims, while using cleaner formatting for parsing and citation.
- Design public pages around high-intent answer-engine questions such as accommodation fit, area fit, arrival logistics, weather risk, no-scooter feasibility, family suitability, remote-work suitability, operator trust, and current local disruption.
- Public agent-readable pages must include entity identity, entity type, area, summary, known strengths, known risks, source list, source types, last verified timestamp, stale fields, confidence, limitations, and recommended verification questions where relevant.
- Provide stable evidence URLs for publicly citable claims where provider permissions allow citation.
- Provide read-only public endpoints for permitted entity summaries, evidence bundles, and risk previews.
- Prioritize Agoda official/partner API access for accommodation lookup if approved.
- Use Tripadvisor/Terra or other permitted APIs for reviews/POI enrichment if approved.
- Use weather APIs such as Open-Meteo or other permitted providers.
- Treat DOT, Surigao del Norte provincial pages, municipal pages, official transport providers, and accreditation lists as higher-authority sources for rules, fees, transport, accreditation, and public-sector context.
- Treat SiargaoLocal, Siargao Finder, Siargao Vibes, operator pages, Klook, Booking.com, Agoda, Tripadvisor, and permitted social/review signals as candidate non-official sources, subject to provider terms, source permissions, and source credibility scoring.
- Treat Facebook, Instagram, Tripadvisor, marketplace reviews, and direct operator channels as trust/sentiment signals where permitted, not as official facts.
- Add a source credibility model that scores or labels source type, authority level, freshness, editorial reliability, disclosure quality, historical stale-risk, known SEO/programmatic-content risk, and allowed-use status.
- Keep source credibility separate from fact confidence. A fact can be recent but still come from a weak or non-authoritative source.
- Prefer current official sources over older commercial or SEO pages when policy, requirements, fees, schedules, or accreditation conflict.
- Flag stale policy content as a risk signal rather than using it as evidence.
- Airbnb is not required for v1 and must not be scraped.
- Analyze manually supplied Airbnb details only with clear confidence limits.
- Cache facts rather than only provider payloads or pages.
- Each fact must carry claim, entity, source, fetch/verify/expiry timestamps, confidence, allowed-use metadata, raw evidence reference, and notes.
- Use freshness windows by fact type: same-day for availability/pricing, 30 days for reviews and internet/power claims, 60-90 days for area/service facts, live or daily for routes/weather, and 30 days or policy-change-triggered for visa/admin.
- Refresh stale data only through allowed sources.
- Model entities, accommodations, areas, routes, providers, source records, source credibility profiles, facts, evidence, reviews, events, closures, fees, public pages, public evidence bundles, agent-readable snapshots, audit requests, audit runs, audit reports, payments, LLM runs, tool calls, and reviewer results.
- Deterministic code owns retrieval, provider permissions, accommodation matching, source freshness, evidence IDs, payment gating, required report structure, and job state transitions.
- The audit generator LLM owns interpretation, tradeoff evaluation, risk ranking, and report writing.
- The audit generator LLM may call controlled read-only tools for accommodation lookup, accommodation facts, reviews, weather, route risks, area profile, service facts, policy facts, and user constraints.
- The audit generator LLM may also call controlled read-only tools for source credibility, official-source checks, event/closure signals, environmental/local fees, and operator trust signals.
- LLM tools must enforce source policy, freshness policy, evidence IDs, confidence/caveats, query budgets, and token budgets.
- The generator should produce structured output that can be validated before rendering.
- Run a separate reviewer LLM pass with a fresh context and separate prompt.
- The reviewer LLM checks citation support, overclaims, stale/low-confidence caveats, traveler relevance, missing critical risks, tone clarity, and green/yellow/red rating rationale.
- The reviewer returns structured corrections rather than free-form prose feedback.
- Deterministic validation still checks required sections, required fields, valid evidence IDs, critical freshness, cited accommodation claims, and payment unlock state.
- Final reports include overall rating, confidence summary, source quality summary, top three risks, full risk table, accommodation assessment, area fit, logistics, weather, internet/power, transport, cash/SIM/services, health/safety/admin, official/accreditation notes where relevant, event/closure/fee notes where relevant, fixes, host questions, evidence/freshness notes, and limitations.
- Use job states: created, resolving, needs_user_input, complete_for_payment, awaiting_payment, paid, generating, reviewing, published, blocked, and failed.
- Include admin/operator visibility for failed matches, provider errors, source freshness issues, blocked audits, and reviewer rejections.
- Track intake completion, accommodation resolution success, completeness pass/fail reasons, preview-to-payment conversion, payment success, generation latency, provider errors, LLM cost, reviewer rejection rate, report confidence distribution, public page indexation, agent-readable page generation, AI-search referrals where detectable, and top cited public pages.

## Testing Decisions

- Test external behavior at the highest practical seam: the audit lifecycle from intake submission through completeness decision, preview risk, payment eligibility, paid generation, reviewer validation, and report publication.
- Prefer one primary integration seam for the audit lifecycle, with provider adapters, payment webhooks, and LLM responses mocked through stable contracts.
- Test that incomplete audits do not become payable.
- Test that a named accommodation below the confidence threshold blocks payment.
- Test that a complete audit exposes one preview risk before payment.
- Test that Stripe webhook verification is required before report unlock.
- Test that stale critical facts either refresh through allowed providers or block the paid audit.
- Test that stale non-critical facts can appear only with explicit freshness/confidence caveats.
- Test that provider adapters reject disallowed source usage before data enters the fact cache.
- Test that Airbnb scraping is not required or invoked in v1.
- Test that source credibility affects report confidence independently from fact freshness.
- Test that current official sources override stale commercial or SEO-style policy pages for policy, fee, accreditation, and transport claims.
- Test that low-credibility sources cannot support high-confidence consequential claims without corroboration.
- Test that stale policy pages are surfaced as stale-source warnings rather than used as current evidence.
- Test that social, marketplace, and operator signals are represented as trust or sentiment evidence rather than official facts.
- Test that live event, closure, ferry, and environmental/local fee modules activate only when relevant evidence exists or the trip timing makes them relevant.
- Test that every user-visible factual claim in a generated report cites a valid evidence ID.
- Test that uncited accommodation claims fail validation.
- Test that invalid evidence IDs fail deterministic validation.
- Test that missing required report sections fail deterministic validation.
- Test that the reviewer LLM can return structured corrections and cause a revision or block.
- Test that public LLM-optimized Markdown and structured JSON pages are generated from the same facts as the human page.
- Test that agent-readable pages do not expose paid report data, private user inputs, raw provider data that cannot be republished, or unsupported claims.
- Test that each public page includes freshness, confidence, source type, canonical URL, and limitations metadata.
- Test that `llms.txt`, sitemap entries, canonical URLs, and JSON-LD metadata point to public pages only.
- Test that public read-only API endpoints enforce allowed-use and public-visibility rules before returning facts.
- Test that risk ranking changes when user constraints or risk tolerance change.
- Test that the report includes the mandatory risk categories for every audit.
- Test that optional modules activate only when relevant intake constraints are present.
- Test that job state transitions prevent impossible states, such as published without paid or reviewed.
- Test that failures preserve enough diagnostic context for admin/operator inspection.
- Test that Panda CSS recipes and shared UI components are used for core pages rather than page-local style sprawl.
- Since no application code exists yet, there is no prior test pattern in this repository. The first implementation should establish integration tests for the audit lifecycle, unit tests for provider policy/freshness/matching utilities, and schema tests for report validation.

## Out of Scope

- Generic AI trip planning.
- From-scratch itinerary generation as the core v1 product.
- Becoming an official government tourism portal.
- Multi-destination support beyond Siargao.
- Commission-driven booking recommendations.
- Affiliate monetization as a core v1 requirement.
- Airbnb API integration as a v1 dependency.
- Scraping prohibited or ToS-risky sources.
- Guaranteeing availability, pricing, or booking outcomes.
- Human concierge fulfillment as the default paid product.
- Mobile native applications.
- Full account system if email-based report links are sufficient for v1.
- Public marketplace or local partner booking flow.
- User-generated public reviews.
- Full free destination guide or editorial content library as part of the first paid-audit release.
- Publishing private paid reports, user-specific travel plans, or non-republishable provider data to public AI-agent surfaces.
- Cloaking or showing materially different factual claims to AI agents than to human users.
- Exhaustive real-time monitoring of every Siargao business, event, closure, fee, and operator.
- Automated refunds beyond normal payment-provider workflows unless required by payment implementation.

## Further Notes

- Destination scope changed from the original long-stay wedge to any Siargao stay length.
- The product should still segment by trip risk and traveler constraint rather than duration.
- The deep-research report expands the market thesis: the paid audit is the first workflow, but the strategic wedge is a source-aware Siargao trust layer over fragmented official, local, booking, review, and social information.
- The strongest product promise is trust: current facts, source credibility, visible confidence, cited evidence, disclosed AI assistance, and no payment when the audit cannot be completed.
- The strongest distribution thesis is answer-engine visibility: become the source that ChatGPT, Claude, Gemini, Perplexity, and similar agents can confidently cite for Siargao accommodation, area, arrival, weather, operator, and trip-risk questions.
- The central technical risk is data access, especially accommodation and review data. Provider access should be validated early.
- A second technical risk is source governance: the system must prevent stale policy pages, low-disclosure content farms, or weak operator pages from supporting high-confidence consequential claims.
- The central product risk is whether users will pay USD 9.99 after seeing one preview risk.
- Continue criteria from the concept docs should be adapted to the automated product: real trip submissions, paid conversions, repeated accommodation resolution, reusable local facts, source credibility wins, successful official-source conflict detection, and user feedback that the value is feasibility rather than itinerary inspiration.
- Issue tracker destination was not available in the local context. Recommended label when publishing to a tracker: `ready-for-agent`.
