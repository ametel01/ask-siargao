# Data Strategy: Autonomous Siargao Fact Graph

This document defines how the product can bulk-build and maintain a large, current Siargao travel database without routine human intervention.

The core principle: the system should not require every record to become trusted. It should ingest automatically, score confidence automatically, publish only what passes policy and quality gates, and leave weak or ambiguous data as untrusted, internal, or incomplete.

## Goal

Build an autonomous evidence pipeline that can support:

- Paid trip risk audits.
- Accommodation and area resolution.
- Public human pages.
- LLM-optimized public pages.
- Public structured JSON endpoints.
- Public evidence bundles where source permissions allow.
- Freshness-aware audit completeness gates.

The product should avoid becoming a manual travel directory. Human intervention should not be required for normal ingestion, refresh, conflict detection, or audit eligibility. Human review may still be useful for source partnerships, legal policy changes, and exceptional source breakage.

## Non-Negotiable Constraints

- Use permitted data only.
- Do not scrape prohibited or ToS-risky sources.
- Do not publish facts that are not allowed to be republished publicly.
- Do not expose private paid audits or user trip details in public pages.
- Do not treat LLM output as a source of truth.
- Do not charge for an audit when critical facts cannot be resolved or refreshed.
- Do not require manual cleanup for normal duplicate, stale, or ambiguous records; model them explicitly.

## High-Level Architecture

```text
source registry
  -> discovery jobs
  -> fetch jobs
  -> raw snapshots where allowed
  -> normalized source records
  -> entity resolution
  -> atomic fact extraction
  -> source credibility scoring
  -> fact confidence scoring
  -> conflict detection
  -> freshness scheduling
  -> audit completeness gate
  -> public page generation where allowed
  -> LLM-readable Markdown/JSON snapshots
```

The database should cache facts, not just provider payloads or crawled pages. Facts are the durable unit of trust, freshness, audit reasoning, and public publication.

## Source Registry

Every source needs a machine-readable policy profile before it enters the pipeline.

```text
source_id
source_name
source_type
access_method: api | sitemap | rss | crawl | user_submitted | partner | official_page
allowed_use: internal_only | public_republish | citation_only | disallowed
robots_policy
terms_url
rate_limit
freshness_window
authority_level
stores_raw_allowed
publishes_raw_allowed
requires_partner_approval
known_stale_risk
known_ai_or_seo_content_risk
notes
```

This profile lets deterministic code decide:

- Can we fetch this source?
- Can we store the raw payload or page?
- Can we extract facts from it?
- Can we use it in a paid audit?
- Can we cite it publicly?
- Can we expose it to LLM/search agents?
- How often should it be refreshed?

No source should enter production ingestion without an explicit source profile.

## Source Priority

### Tier 1: Official And High-Authority Sources

Use for policy, safety, accreditation, transport, fees, closures, public services, and rules.

Examples:

- DOT and accreditation sources.
- Surigao del Norte provincial sources.
- Municipal sources.
- Official ferry, airline, airport, port, or transport sources.
- Official weather and hazard sources where relevant.

These sources should override older commercial or SEO-style content when they conflict on policy, fees, schedules, accreditation, or public-sector facts.

### Tier 2: Partner And Licensed APIs

Use where provider terms allow storage, processing, citation, and/or republication.

Candidate categories:

- Accommodation inventory and metadata.
- POI/location details.
- Ratings and review summaries.
- Weather forecast and historical weather.
- Geocoding and maps.

Examples to evaluate:

- Google Places API for establishment and POI data.
- Open-Meteo for forecast and historical weather.
- Tripadvisor/Terra or approved Tripadvisor APIs for location, rating, photo, and review-related data where terms allow.
- Agoda partner/demand APIs for hotel content, availability, and rate data if access is approved.

### Tier 3: Permitted Public Web Sources

Use only when robots, terms, and source policy allow automated access and storage.

Examples:

- Public official pages.
- Public sitemaps or RSS feeds.
- Local directory pages only if terms permit the intended use.
- Operator pages only if permitted.

If a site prohibits scraping or republication, do not ingest it as a core automated source. The system may still use it as market research outside production data flows, or pursue a partnership.

### Tier 4: User-Submitted And Host-Submitted Evidence

Use when the user or host provides details directly.

Examples:

- Listing link.
- Screenshot.
- Exact address.
- Host-provided Wi-Fi speed test.
- Host answers to structured questions.
- Operator policy details.

User-submitted evidence can support a private paid audit, but it should not become public unless the user or provider explicitly grants publication rights.

## Bulk Build Process

### Step 1: Seed Geography And Taxonomy

Create base entities for:

- Island and municipalities.
- Barangays and commonly used travel areas.
- Arrival routes.
- Ports, airport, ferry terminals, and transfer nodes.
- Risk categories.
- Accommodation categories.
- Operator/activity categories.
- Practical service categories.

This taxonomy should be stable and destination-specific, but stored in a way that later destinations can add their own rules.

### Step 2: Discover Candidate Entities

Use allowed structured sources first:

- Place/POI APIs.
- Approved accommodation APIs.
- Official business/accreditation lists.
- Official tourism/business directories.
- Partner feeds.
- Permitted public sitemaps.

Candidate entities should be inserted with low initial confidence until they are resolved and deduplicated.

```text
candidate_entity_id
candidate_name
candidate_type
source_id
source_record_id
raw_location
raw_category
raw_contact
discovery_confidence
created_at
```

### Step 3: Normalize Source Records

Each provider adapter converts source-specific records into normalized records.

```text
source_record_id
source_id
provider_entity_id
entity_type
name
aliases[]
address
area
coordinates
phone
website
categories[]
rating
review_count
price_signals
hours
amenities
source_url
fetched_at
raw_snapshot_id
allowed_use
```

Raw snapshots should be stored only where provider terms allow it.

### Step 4: Resolve Entities

Entity resolution merges duplicate records across providers without manual cleanup.

Signals:

- Provider IDs.
- Name similarity.
- Alias similarity.
- Coordinates and geohash.
- Address and area.
- Phone number.
- Website/domain.
- Category compatibility.
- Review platform URL.
- Accommodation platform URL.
- Operator social profile.

Resolution outputs:

```text
entity_id
match_status: confident | probable | ambiguous | rejected
match_score
matched_source_record_ids[]
conflict_reasons[]
requires_user_followup: boolean
```

Only `confident` and carefully defined `probable` matches should support paid audit claims. `ambiguous` matches should stay internal, appear with caveats, or trigger user follow-up.

### Step 5: Extract Atomic Facts

The durable database unit is an atomic fact.

```text
fact_id
claim
entity_type
entity_id
fact_type
source_type
source_id
source_record_id
evidence_id
fetched_at
verified_at
expires_at
confidence
source_authority
public_republish_allowed
audit_use_allowed
raw_evidence_allowed
conflicts_with_fact_ids[]
notes
```

Examples:

- "This accommodation is in General Luna."
- "This accommodation has a Google rating of 4.6 from 320 reviews."
- "This route requires a ferry leg."
- "This fact about opening hours expires in 30 days."
- "This weather risk is based on forecast data fetched today."

Facts should be small enough to cite, expire, conflict-check, and refresh independently.

### Step 6: Score Credibility And Confidence Separately

Source credibility is about the source.

Fact confidence is about the claim.

A recent claim from a weak source can be low-confidence. An old official claim can be high-authority but stale. The system must keep these dimensions separate.

Source credibility inputs:

- Source type.
- Authority level.
- Terms and allowed-use clarity.
- Historical stale rate.
- Editorial disclosure.
- Known SEO/programmatic-content risk.
- Official or partner status.
- Past conflict rate.

Fact confidence inputs:

- Match quality.
- Number of corroborating sources.
- Source authority.
- Freshness.
- Conflict status.
- Fact type.
- Extraction confidence.
- Whether the fact is directly stated or inferred.

### Step 7: Detect Conflicts

Conflict detection should run automatically.

Examples:

- Different area or coordinates for same accommodation.
- Different opening hours.
- Different contact details.
- Official ferry schedule conflicts with commercial guide.
- Review sentiment conflicts with operator marketing.
- Accommodation name resolves to multiple places.
- A public page makes a stale policy claim.

Conflicts should not require manual resolution. They should lower confidence, trigger targeted refresh, and appear as caveats when relevant.

## Keeping Data Fresh

Use freshness windows by fact type.

| Fact type | Default freshness | Refresh behavior |
| --- | --- | --- |
| Weather forecast | Live or daily | Refresh before every relevant audit. |
| Arrival routes, ferries, flights | Daily or audit-time | Refresh before payment when route is critical. |
| Availability and pricing | Query-time only | Do not rely on stale cache for claims. |
| Reviews and ratings | 7-30 days | Refresh for active audits and high-traffic public pages. |
| Opening hours | 7-30 days | Refresh when used in audit or public page. |
| Internet and power claims | 30 days | Refresh or request host/user evidence. |
| Area and service facts | 60-90 days | Refresh by traffic and audit demand. |
| Official policy, fees, accreditation | 30 days or change-triggered | Refresh on schedule and when conflicts appear. |
| Static geography | Rarely | Refresh only after source change or dispute. |

## Refresh Scheduler

The refresh queue should be priority-based.

Highest priority:

- Facts required for an active audit.
- Stale critical facts before payment.
- Public pages with traffic or AI referrals.
- Public pages cited or accessed often.
- Facts with detected conflicts.
- Official policy, fee, transport, and accreditation sources.
- High-value accommodation and operator entities.

Lower priority:

- Low-traffic entities.
- Non-critical amenities.
- Weak or untrusted sources.
- Facts not currently used in audits or public pages.

Refresh jobs should be idempotent and provider-aware:

```text
refresh_job_id
fact_id or source_id or entity_id
refresh_reason
priority
provider_budget
scheduled_at
attempt_count
last_error
result_status
```

## Targeted Refresh Before Payment

The paid audit flow should not rely only on the bulk database.

Before Stripe Checkout:

```text
1. Resolve accommodation, area, route, dates, and top constraint.
2. Identify required fact types.
3. Check freshness and confidence.
4. Refresh stale critical facts through allowed sources.
5. Recompute completeness.
6. Show preview risk only if enough evidence exists.
7. Allow payment only if the audit can be completed.
```

If targeted refresh fails for a critical fact, do not charge. Return a clear incomplete-audit reason and ask for user evidence only if it can realistically unblock the audit.

## Change Detection

For allowed web sources:

- Use `ETag` and `Last-Modified` where available.
- Track sitemap and RSS changes.
- Hash relevant page sections.
- Compare extracted facts, not just raw HTML.
- Expire facts when source pages disappear.
- Lower confidence when a source changes structure unexpectedly.

For APIs:

- Store provider IDs.
- Track schema versions where available.
- Poll by freshness class.
- Respect rate limits and quotas.
- Record provider health.
- Fall back to stale-with-caveat only for non-critical facts.

## LLM Role In Data Operations

LLMs can help with:

- Extracting structured facts from allowed messy pages.
- Classifying page type and source type.
- Summarizing allowed review themes.
- Detecting contradictions.
- Generating host/operator verification questions.
- Explaining why a fact is low-confidence.
- Ranking which facts matter for a specific trip.

LLMs must not:

- Invent facts.
- Bypass source policy.
- Publish non-republishable provider data.
- Decide payment eligibility without deterministic checks.
- Replace evidence IDs.

Every LLM-extracted fact must include source evidence and pass deterministic schema validation before entering the fact graph.

## Public Page Generation

Public pages should be generated from the same fact graph as paid audits, but only from facts marked as public.

For each eligible entity or topic:

- Human page.
- LLM Markdown page.
- Structured JSON endpoint.
- JSON-LD metadata.
- Public evidence bundle where allowed.
- Sitemap entry.
- `llms.txt` entry for high-value indexes and pages.

Public eligibility gate:

```text
public_republish_allowed == true
confidence >= threshold
critical_claims_have_public_evidence == true
no_private_user_data == true
no_non_republishable_raw_provider_content == true
canonical_entity_match_status in confident | probable
```

If a page lacks enough public evidence, it should stay unpublished, `noindex`, or publish only a narrow summary with limitations.

## Data Model Additions

Beyond the core PRD/TECH tables, implementation should include these concepts:

```text
source_profiles
source_permissions
raw_snapshots
candidate_entities
entity_matches
fact_confidence_scores
source_credibility_scores
fact_conflicts
refresh_jobs
provider_health_checks
public_page_generation_jobs
public_visibility_decisions
```

These can be separate tables or modeled through existing `providers`, `source_records`, `facts`, `evidence`, and `public_pages` tables depending on the ORM design.

## Automation Without Human Intervention

The system should handle these cases automatically:

- Duplicate entities.
- Ambiguous matches.
- Stale facts.
- Source conflicts.
- Provider failures.
- Low-confidence evidence.
- Missing critical facts.
- Public page eligibility failures.
- Audit incompleteness.

Automatic actions:

- Mark ambiguous instead of merging.
- Lower confidence instead of trusting.
- Refresh stale facts when allowed.
- Block payment when critical facts are missing.
- Ask the user for evidence when it can help.
- Avoid public publication when rights or confidence are insufficient.
- Log provider/source failures for operator visibility.

## What Fully Automated Does Not Mean

Fully automated does not mean:

- Perfect database.
- Full review corpus from every platform.
- Guaranteed real-time accuracy.
- Scraping prohibited sources.
- Resolving every ambiguous listing.
- Publishing every discovered entity.
- Charging for every submitted trip.

Fully automated should mean:

- Large autonomous fact cache.
- Source-ranked evidence graph.
- Confidence-gated paid audits.
- Just-in-time refresh before payment.
- Public pages generated only from permitted facts.
- No routine human cleanup.
- Clear incompleteness states when the system cannot support a claim.

## Early Implementation Milestones

1. Build the source registry and source permission model.
2. Seed geography, area, route, and category taxonomy.
3. Implement one official/source-page adapter and one API adapter.
4. Implement entity resolution for accommodations and areas.
5. Store atomic facts with evidence, freshness, confidence, and allowed-use metadata.
6. Implement freshness windows and refresh jobs.
7. Implement the audit completeness gate using the fact graph.
8. Implement public visibility decisions.
9. Generate one public human page, one `llm.md`, one JSON endpoint, and one evidence bundle from the same facts.
10. Add observability for ingestion success, match confidence, stale facts, provider errors, and public-page eligibility.

## Validation Metrics

Track:

- Number of discovered candidate entities.
- Entity resolution success rate.
- Ambiguous match rate.
- Fact extraction success rate.
- Fact confidence distribution.
- Source conflict rate.
- Stale critical fact count.
- Refresh success rate.
- Provider error rate.
- Completeness gate pass rate.
- Payment block reasons.
- Public page eligibility rate.
- Public page generation success.
- AI-search referrals where detectable.
- Top cited public pages.

## Initial Source References To Evaluate

- Google Places API: https://developers.google.com/maps/documentation/places/web-service/overview
- Google Place Details: https://developers.google.com/maps/documentation/places/web-service/place-details
- Open-Meteo: https://open-meteo.com/
- Open-Meteo Historical Weather API: https://open-meteo.com/en/docs/historical-weather-api
- Tripadvisor Content API: https://developer-tripadvisor.com/content-api/
- Tripadvisor location documentation: https://developer-tripadvisor.com/content-api/documentation/location/
- Agoda Direct Supply documentation: https://developer.agoda.com/demand/docs/getting-started
- Agoda search API documentation: https://developer.agoda.com/demand/docs/json-search-api

Provider access, terms, storage rights, and republication rights must be verified before production use.
