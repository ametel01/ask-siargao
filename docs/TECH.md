# Siargao Trip Risk Audit Technical Spec

## Purpose

Build a production-grade web application that audits Siargao trip plans for feasibility, trust, and operational risk. The product is not a generic itinerary generator. It evaluates whether a user's stated plan is likely to work, what may break, and how to fix the highest-risk parts before booking.

The initial destination scope is Siargao. The architecture should keep destination-specific rules isolated so later destinations can be added without rewriting the core audit engine.

## Product Decisions

- Any stay length is supported.
- The first product is a trip feasibility audit, not a from-scratch planner.
- The paid product is one full audit for USD 9.99.
- Users receive one free preview risk before payment.
- Payment is requested only after the system confirms that the audit can be completed to the promised standard.
- If a critical input or accommodation match cannot be resolved with sufficient confidence, the user is not charged.
- The audit uses permitted data only: official APIs, licensed feeds, public sources whose terms allow automated collection, user-submitted details, local verified records, and direct partner/host data.
- No ToS-risky scraping is allowed for core product data.
- Named accommodation or business recommendations require provenance.
- Booking or affiliate links are not part of the v1 core promise.
- AI answer-engine visibility is a first-class distribution surface. Public pages should be easy for ChatGPT, Claude, Gemini, Perplexity, and similar systems to retrieve, parse, and cite.
- Agent-readable public content must use the same factual claims as human pages. Do not cloak, invent parallel facts, or expose private audit data to AI crawlers.

## Production Stack

Use Option A:

- Framework: Next.js App Router
- Language: TypeScript
- Styling: Panda CSS
- UI components: shadcn/ui component blueprints adapted into local project components
- UI primitives: Ark UI or Radix primitives where useful
- Database: Postgres
- ORM: Drizzle or Prisma
- Background jobs: Redis-backed worker system, Trigger.dev, Inngest, or equivalent
- Payments: Stripe Checkout
- LLM orchestration: OpenAI Responses API or OpenAI Agents SDK for TypeScript
- Observability: Sentry, PostHog, structured audit logs
- Deployment: Vercel for the app plus managed Postgres/Redis, or Docker deployment if workers require more control

Do not use Tailwind CSS as the production styling system. Styling should be centralized through Panda tokens, recipes, and shared UI components so visual decisions stay consistent across pages.

Use shadcn/ui as a component-pattern and local-code source, not as an imported black-box UI kit. Any shadcn-generated component should be committed as local code, reviewed, and adapted to the project's Panda recipes and tokens. Do not keep Tailwind utility styling, Tailwind global imports, or page-local utility sprawl in production components.

## Frontend Architecture

Suggested source layout:

```text
src/
  app/
  features/
    audit/
    intake/
    payment/
    report/
  server/
    audit/
    providers/
    llm/
    jobs/
    db/
  ui/
    components/
      shadcn/
    recipes/
  theme/
    tokens.ts
    recipes.ts
    global.css
```

Frontend screens:

- Landing/intake page
- Audit completeness and preview page
- Checkout handoff
- Audit processing status page
- Final report page
- Public accommodation, area, route, operator, and risk pages
- Agent-readable Markdown and JSON variants for each public page
- Public evidence pages for citable claims where source permissions allow republication
- Admin/operator review page for failed matches, provider errors, and source freshness issues

The UI should feel like a practical decision tool, not a marketing site. The first screen should let the user start an audit.

## shadcn/ui Usage Policy

shadcn/ui should accelerate accessible component implementation while preserving this project's design system.

Use shadcn-derived components for:

- `Button`
- `Badge`
- `Card`
- `Accordion`
- `Dialog`
- `Sheet`
- `Tabs`
- `DropdownMenu`
- `Popover`
- `Tooltip`
- `Form`
- `Input`
- `Select`
- `Textarea`
- `Table`
- `Separator`
- `Skeleton`
- `Toast`

Rules:

- Treat generated shadcn code as editable local source.
- Replace Tailwind classes with Panda recipes, `css` calls, or slot recipes.
- Keep Radix accessibility behavior and keyboard interactions where the generated component uses Radix.
- Keep component APIs small and product-specific where possible; do not expose every shadcn variant if the product does not need it.
- Shared UI components should live under `src/ui/components`.
- shadcn-derived base components may live under `src/ui/components/shadcn` or be merged into the normal component library after restyling.
- Project-specific composed components such as `RiskPreviewCard`, `AuditIntakeForm`, and `ReportEvidenceTable` should wrap base components rather than duplicating primitive behavior.
- Do not let shadcn defaults override the landing-page visual system, Panda tokens, or accessibility requirements.

## AI Agent Visibility Architecture

Public content should be built for both humans and retrieval agents. For every public entity or risk page, generate:

- Human page: `/accommodations/[slug]`, `/areas/[slug]`, `/routes/[slug]`, `/operators/[slug]`, or `/risks/[slug]`
- LLM Markdown: `/accommodations/[slug]/llm.md`
- Structured JSON: `/api/public/accommodations/[slug].json`
- Public evidence bundle: `/evidence/[evidenceBundleId]`
- JSON-LD embedded in the human HTML page
- Canonical URL
- XML sitemap entry
- `llms.txt` index entry when the page belongs in the agent-facing knowledge surface

Agent-readable Markdown should be concise, factual, and citation-ready:

```text
# Entity Name

Entity type:
Area:
Last verified:
Confidence:
Canonical URL:

## Summary

## Known Strengths

## Known Risks

## Freshness And Limitations

## Evidence

## Recommended Verification Questions
```

Structured JSON should expose the same data shape:

```text
slug
entity_type
canonical_url
summary
area
known_strengths[]
known_risks[]
source_summary[]
evidence_ids[]
last_verified_at
stale_fields[]
confidence
limitations[]
recommended_questions[]
```

Rules:

- Agent-readable pages must be generated from normalized facts and evidence, not hand-written parallel copy.
- Agent-readable pages may simplify formatting, but must not materially differ from the human-visible factual claims.
- Public pages may include only facts marked as allowed for public republication.
- Private audit reports, user trip details, payment state, raw provider payloads, and non-republishable evidence must never appear in public agent-readable surfaces.
- If a claim cannot be cited publicly because of provider terms, the page should either omit the claim or summarize it as an internal confidence signal without exposing restricted source content.
- Use `noindex` only for private, duplicate, incomplete, or low-confidence pages. High-quality public pages should be crawlable.
- Keep pages server-rendered or statically generated where practical so crawlers and AI retrieval systems can parse content without client-side execution.

Initial answer-engine page families:

- Accommodation fit pages: `Is [accommodation] in Siargao good for [constraint]?`
- Area fit pages: `Where to stay in Siargao without a scooter`
- Arrival logistics pages: `Can I arrive in Siargao late from [origin]?`
- Weather risk pages: `Is Siargao good in [month]?`
- Operator trust pages: `Is [operator] a safe bet?`
- Constraint pages: family, remote work, quiet sleep, surfing, accessibility, medical access, budget, no scooter

The initial `llms.txt` should point to public indexes rather than every low-level page:

```text
# Siargao Trip Risk Audit

## Core Public Pages
/trip-risk-audit
/areas
/accommodations
/routes
/risks

## Agent-Readable Indexes
/llm/accommodations.md
/llm/areas.md
/llm/routes.md
/llm/risks.md
/llm/evidence-index.md

## Public API
/api/public/entities
/api/public/evidence
/api/public/risk-preview
```

## Intake Model

Minimum viable input:

- Travel dates or travel month
- Arrival route or origin
- Planned stay area or accommodation name
- Top user constraint

Optional inputs:

- Accommodation name
- Accommodation platform or listing link
- Traveler type
- Group size
- Children or family needs
- Remote work needs
- Surfing goals
- Quiet sleep needs
- Budget sensitivity
- Transport comfort
- Medical access concerns
- Food or accessibility constraints
- Risk tolerance: relaxed, balanced, or low-risk

The intake should ask for the accommodation name first. The system should attempt to resolve it through permitted provider APIs or local data. If it cannot resolve the accommodation confidently, it may ask for a platform link, listing text, screenshots, exact address, or host-provided details.

## Audit Completeness Gate

An audit can be sold only when the system can evaluate:

- Dates or travel month
- Arrival route or origin
- Stay area
- Accommodation identity, or an explicit no-accommodation case
- Weather and seasonality
- Core logistics
- At least one user-stated top constraint

If the user names an accommodation, the match must meet the configured confidence threshold. Otherwise the audit remains incomplete and unpaid.

The completeness check should run before Stripe Checkout. The result should include:

- `can_complete: boolean`
- `blocking_reasons: string[]`
- `preview_risk`
- `required_user_followups`
- `evidence_summary`

## Risk Categories

Every audit checks:

- Arrival and departure logistics
- Weather and seasonality
- Area fit
- Internet and power
- On-island transport
- Cash, SIM, and basic services
- Health, safety, and admin

Optional modules:

- Remote work
- Family and kids
- Surfing
- Quiet sleep
- Budget sensitivity
- Arrival timing
- Transport comfort
- Medical access
- Accessibility
- Nightlife
- Food restrictions

Risks are ranked by:

- Impact
- Likelihood
- Fixability
- Traveler relevance

Each risk must include:

- What might break
- Why it matters for this traveler
- Evidence
- Freshness and confidence
- Recommended fix

## Data Sources And Policy

Provider adapters must enforce allowed use before data enters the audit cache. The app should prefer:

- Official accommodation APIs, starting with Agoda if partner access is approved
- Tripadvisor/Terra or other permitted review/POI enrichment APIs if access is approved
- Weather APIs such as Open-Meteo or other permitted weather providers
- Official transport, airline, ferry, government, or public-service sources
- Direct host questionnaires
- Local partner records
- User-submitted accommodation details

Airbnb is not required for v1. Do not depend on Airbnb scraping. If a user provides Airbnb details manually, analyze the submitted information with clear confidence limits.

Every provider adapter should expose:

- Source name
- Access method
- Allowed-use policy
- Rate limits
- Retry policy
- Data freshness policy
- Normalized records
- Raw evidence snapshots where permitted

## Fact Cache And Provenance

The database should cache facts, not just pages or provider responses. Each fact should carry provenance:

```text
claim
entity_type
entity_id
source_type
source_name
source_url_or_api
fetched_at
verified_at
expires_at
confidence
allowed_use
raw_evidence_id
notes
```

Freshness windows:

- Availability and pricing: same day
- Reviews: 30 days
- Internet and power claims: 30 days
- Area and service facts: 60-90 days
- Routes and weather: live or daily
- Visa and admin: 30 days or policy-change triggered

When cached data is stale, the system should refresh it only through an allowed source. If refresh fails for a critical fact, the audit should either block payment or clearly mark the final audit incomplete.

## Core Data Model

Initial tables:

- `users`
- `audit_requests`
- `audit_inputs`
- `audit_runs`
- `audit_completeness_checks`
- `audit_reports`
- `payments`
- `entities`
- `accommodations`
- `areas`
- `routes`
- `providers`
- `source_records`
- `facts`
- `evidence`
- `reviews`
- `public_pages`
- `public_evidence_bundles`
- `agent_readable_snapshots`
- `llm_runs`
- `llm_tool_calls`
- `reviewer_results`

The data model should distinguish:

- Entity: the thing being discussed, such as an accommodation or area.
- Source record: normalized data from a provider.
- Fact: a claim extracted from one or more source records.
- Evidence: the cited support for facts used in an audit.
- Report: the user-facing output generated from facts and evidence.
- Public page: a human and agent-readable representation of public facts for an entity, route, area, operator, or risk topic.
- Agent-readable snapshot: a generated Markdown/JSON version of a public page with freshness, confidence, source, and limitation metadata.

Public page records should track:

```text
slug
page_type
entity_id
canonical_url
human_path
llm_markdown_path
json_api_path
evidence_bundle_id
last_generated_at
last_verified_at
confidence
public_visibility
indexing_status
stale_fields
generation_source_fact_ids
```

## LLM Architecture

Deterministic code owns:

- Data retrieval
- Provider permissions
- Accommodation matching
- Source freshness
- Evidence IDs
- Payment gating
- Required report structure
- Job state transitions

The LLM owns:

- Interpreting the user's trip context
- Calling approved read-only retrieval tools
- Evaluating tradeoffs
- Ranking risks
- Explaining recommendations
- Writing the report in clear language

The audit generator LLM gets controlled read-only tools:

- `find_accommodation`
- `get_accommodation_facts`
- `get_reviews`
- `get_weather`
- `get_route_risks`
- `get_area_profile`
- `get_service_facts`
- `get_policy_facts`
- `get_user_constraints`

Public agent-facing retrieval can use a smaller read-only tool/API set:

- `resolve_public_entity`
- `get_public_entity_summary`
- `get_public_evidence_bundle`
- `get_public_risk_preview`
- `get_public_area_profile`
- `get_public_route_profile`

Tooling rules:

- Tools return evidence IDs with every factual result.
- Tools enforce allowed source policy.
- Tools enforce freshness rules.
- Tools expose confidence and caveats.
- Tools have query and token budgets.
- Tools never expose unsupported provider data to the report.
- Public tools return only facts approved for public visibility and republication.

The generator should produce structured output, not only prose.

## Reviewer LLM

Run a separate reviewer LLM pass with a fresh context and a separate prompt before the user sees the final report.

Reviewer responsibilities:

- Check citation support
- Flag overclaims
- Check stale or low-confidence caveats
- Check traveler-specific relevance
- Identify missing critical risks
- Check tone clarity
- Validate the green/yellow/red rating rationale

The reviewer should return structured corrections. The system can then revise the report, block publication, or mark sections as needing more evidence.

Lightweight deterministic validation should still check:

- Required sections exist
- Required fields are present
- Evidence IDs are valid
- Critical facts are fresh enough
- Accommodation claims are cited
- Payment state allows report unlock

## Report Schema

The final audit report should include:

- Overall green/yellow/red trip risk rating
- Confidence summary
- Top 3 risks
- Full risk table
- Accommodation assessment
- Area fit assessment
- Arrival/departure logistics
- Weather and seasonality notes
- Internet and power assessment
- Transport notes
- Cash, SIM, and service notes
- Health, safety, and admin notes
- Recommended fixes
- Accommodation questions to ask before booking
- Evidence and freshness notes
- Limitations

The report should make uncertainty visible. It should not imply that the system knows unverified facts.

## Payment Flow

1. User submits intake.
2. System resolves core data and checks audit completeness.
3. System shows one free preview risk.
4. If complete, user pays USD 9.99 through Stripe Checkout.
5. On successful payment webhook, enqueue final audit generation.
6. Generate report using controlled retrieval tools.
7. Run reviewer LLM and deterministic checks.
8. Publish report or request more data if a critical blocker is found.

Stripe is the source of truth for payment state. Reports should unlock only after a verified webhook event.

## Background Job Flow

Use jobs for:

- Accommodation resolution
- Provider data refresh
- Weather and route refresh
- Fact extraction
- Audit generation
- Reviewer pass
- Report publication
- Public page generation
- Agent-readable snapshot generation
- Sitemap and `llms.txt` refresh
- Retry handling

Audit job states:

```text
created
resolving
needs_user_input
complete_for_payment
awaiting_payment
paid
generating
reviewing
published
blocked
failed
```

Failures should preserve enough context for support and debugging.

## Styling System

Panda CSS should define:

- Color tokens
- Typography tokens
- Spacing tokens
- Radius tokens
- Shadow tokens
- Layout recipes
- Button recipes
- Form field recipes
- Alert/risk badge recipes
- Report section recipes
- Data table recipes

Application pages should compose shared UI components and recipes. Avoid page-local one-off styling unless it is a deliberate new component candidate.

## Security And Compliance

Initial requirements:

- Do not scrape prohibited sources.
- Store provider credentials server-side only.
- Validate Stripe webhooks.
- Keep user-submitted trip data private by default.
- Keep private paid reports and user-specific audit inputs out of public pages, `llms.txt`, sitemaps, JSON-LD, and public APIs.
- Log LLM inputs and outputs with care because they may contain travel plans and personal details.
- Redact sensitive values from traces where possible.
- Rate-limit intake, resolution, and provider calls.
- Keep audit evidence snapshots only where provider terms allow storage.
- Publish public evidence only where provider terms allow citation or republication.
- Do not cloak. Agent-readable Markdown/JSON must expose the same factual claims as the human page, with formatting optimized for retrieval and citation.

## Observability

Track:

- Intake completion rate
- Accommodation resolution success rate
- Completeness gate pass/fail reasons
- Preview-to-payment conversion
- Payment success rate
- Audit generation latency
- Provider error rate
- LLM cost per audit
- Reviewer rejection rate
- Published report confidence distribution
- Public page generation failures
- Agent-readable snapshot freshness
- Public API usage
- AI-search referrals where detectable
- Top landing pages from ChatGPT, Claude, Gemini, Perplexity, and other answer engines where referrer data is available
- Indexation and crawl coverage for sitemap and agent-readable pages

Use structured logs for audit runs, provider calls, tool calls, and reviewer results.

## Open Decisions

- Choose Drizzle or Prisma.
- Choose the first background job runner.
- Decide whether auth is required for v1 or whether email-based report links are enough.
- Confirm first provider access path for Agoda and Tripadvisor/Terra.
- Choose the initial map/geocoding provider.
- Define exact accommodation matching confidence thresholds.
- Define the first admin interface scope.
- Define minimum confidence and source coverage thresholds for publishing public pages.
- Decide which public pages belong in `llms.txt` versus only the XML sitemap.
- Define the first answer-engine monitoring dashboard and referral attribution rules.
