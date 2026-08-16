# Qualified Discovery Strategy

Status: approved design as of 2026-08-16; not an as-built claim.

Ask Siargao will treat search and AI-agent visibility as a product trust and conversion problem,
not as a crawler-file problem. The intended outcome is Qualified Discovery: a visit attributable
to search or an external reference that results in an admitted Travel Answer within the same
privacy-safe Visibility Journey.

This strategy turns the dated [LLM visibility audit](../../../LLM_VISIBILITY_AUDIT.md) into an
implementation contract. External indexing, backlink, and crawler observations in that audit must
be refreshed before they are used as current evidence. The domain language is authoritative in
[CONTEXT.md](../../../CONTEXT.md).

## Why crawlability is not the outcome

The repository already implements permissive public crawling, a sitemap, `llms.txt`, Markdown
representations, server-rendered pages, and structured public content. Those surfaces make content
retrievable, but they do not establish that search engines indexed it, that third parties trust it,
or that discovered travelers receive useful answers.

The strategy therefore separates four evidence layers:

1. **Retrievability** — a crawler can fetch and understand the intended public representation.
2. **Indexing** — a search engine reports the canonical HTML URL as indexed.
3. **Authority** — independent sources evaluate or reference the relevant content or product.
4. **Qualified Discovery** — an attributable visit culminates in durable Travel Answer admission.

Passing an earlier layer does not imply that a later layer passed.

## Observed repository state

These are source-backed implementation facts, not claims about the live deployment:

- The homepage describes a travel assistant but does not plainly identify AI in its visible product
  category. Homepage JSON-LD contains `WebSite` and `Organization`, not `WebApplication`.
- Planning guides visibly show institutional author and reviewer labels, a last-checked date,
  sources, limitations, editorial method, corrections policy, and commercial disclosure. There is
  no public About, accountable-editor profile, or contact route.
- Article JSON-LD lacks publication and modification dates and a named author profile URL. The
  visible checked date is not represented by a semantic `time` element.
- The homepage's example Reality Check is a prompt and method preview, not a Worked Reality Check
  containing observed inputs, evidence, a bounded recommendation, limitations, and a fallback.
- Markdown alternatives do not currently send an HTTP canonical link or `X-Robots-Tag`.
- Planning-guide views and Reality Check clicks share an ephemeral guide journey. That identity is
  not propagated into chat, server Reality Check completion, or Travel Answer persistence.
- `reality_check_completed` occurs before durable Travel Answer admission. No analytics event proves
  that admission succeeded.
- The repository uses a custom PostHog-compatible server sink rather than a PostHog SDK. Production
  PostHog delivery remains disabled and conditional in the
  [vendor register](../reference/production-vendor-register.md).

The current planning-guide event contract is described in
[Planning Guide Analytics](../reference/planning-guide-analytics.md).

## Product and claim model

The distinctive category is **Siargao Trip Copilot**. Public copy should lead with:

> Your Siargao trip copilot

The immediate explanation should make the mechanism classifiable without collapsing the product
into a generic category:

> Ask Siargao is an AI-powered travel assistant that reality-checks your plans using current
> evidence, Siargao-specific planning context, and explicit limitations.

A supporting proof statement should name concrete decisions rather than promise universal local
knowledge:

> Check weather-sensitive activities, locations, transfers, and disruption fallbacks before you
> commit.

Claims use the following contract:

| Claim | Meaning | Must not imply |
| --- | --- | --- |
| Live Evidence | Retrieved from an external source during the current request, with retrieval time available | Accurate real-time truth or safety clearance |
| Current Evidence | Reviewed within the declared freshness window appropriate to the claim | Retrieved during the current request |
| Siargao-Specific Planning Context | Governed island-specific knowledge used to interpret evidence and constraints | Locally based staff or unnamed first-hand review |
| Reality Check | Evaluation method for a proposed decision or plan | Booking confirmation, safety approval, or a stored Travel Answer |

Public copy must avoid an unqualified claim that Ask Siargao decides what is safe.

## Editorial accountability

**Alex Metelli — Founder and Accountable Editor** is the approved public identity. The profile may
state responsibility for the editorial method, corrections, and content claims. It must not claim
residence, local status, Siargao experience, or independent review until a precise statement and
supporting evidence are approved.

The public accountability surface should include:

- the Accountable Editor's real name and role;
- the evidence-led editorial method;
- a corrections contact;
- disclosure of how AI assists content production;
- truthful external profile links only; and
- a named reviewer only when that person performed a review and their relevant relationship is
  disclosed.

The labels “Ask Siargao Editorial Desk” and “Ask Siargao Local Knowledge Review” should not stand in
for accountable people. Until a qualified reviewer participates, guides should use evidence-led
organizational authorship and name Alex Metelli as the Accountable Editor.

### Editorial dates

Each guide has three separate dates:

- **Guide Publication Date** is set at first publication and never changes.
- **Guide Modification Date** changes only after a substantive recommendation or content change.
- **Evidence Check Date** changes only after time-sensitive claims and cited evidence are reviewed.

Typography, formatting, and other non-substantive edits change none of these dates. Material
corrections should be visible. Article metadata should expose publication and modification dates in
ISO 8601 form, and visible dates should use semantic `time` elements.

## Content system

The complete travel guide is the pillar. Narrow pages must own a distinct traveler decision rather
than duplicate paragraphs from the pillar. The first decision pages are:

1. Siargao without a scooter
2. General Luna versus Pacifico
3. Late arrival at Sayak Airport or Dapa Port

Worked Reality Checks live under `/reality-checks/` as a separate collection. They demonstrate the
product method while guides provide durable reference context. The first examples are:

1. Cloud 9 under weather and tide constraints
2. A fallback after a cancelled island tour

Every Worked Reality Check must include:

- a realistic synthetic traveler scenario;
- location, timing, and traveler constraints;
- evidence checked and its timestamp;
- verified facts separated from unresolved assumptions;
- a bounded recommendation;
- limitations and a validity window;
- a practical fallback; and
- a link to request a current personalized Travel Answer.

Worked Reality Checks are hand-authored editorial artifacts and never republished Travel Answers.
The ownership and privacy rationale is recorded in
[ADR-0015](../../../docs/adr/0015-keep-worked-reality-checks-separate-from-travel-answers.md).

Editorial claims prefer evidence in this order:

1. Official or primary sources
2. Live provider evidence for time-sensitive conditions
3. Named first-hand review with its date and scope
4. Reputable secondary sources
5. Clearly labeled planning estimates

An uncited “local tip” must not become an authoritative claim.

The [Siargao field research playbook](../how-to-guides/run-siargao-field-research.md) defines how
first-hand material is captured from 2026-08-22 onward. Capture or upload alone does not satisfy the
third evidence level: a Field Observation must retain its method, conditions, rights, freshness,
and limitations and complete Fact Admission under the proposed
[field research data model](../reference/field-research-data-model.md) before it can support a public
claim or agent answer.

## Search representation and notification

Human HTML pages remain canonical. Markdown and public JSON alternatives remain crawlable for
agents, but should send both an HTTP canonical link to the corresponding HTML page and
`X-Robots-Tag: noindex` so they do not compete in search results.

The homepage should expose truthful `WebApplication` structured data with:

- the canonical product name and description;
- `applicationCategory` describing a travel application;
- `operatingSystem: Web`;
- a bounded feature list; and
- only offers that are currently available to the public.

A paid Trip Pass must not be advertised while Checkout Mode is `off` or limited to the Checkout
Canary. Guide metadata should link named authors to real profiles, expose the approved date
semantics, and use the guide's actual social image.

Search notification follows an evidence-preserving contract:

- sitemap `lastmod` changes only after substantive editorial or evidence changes;
- Google indexing is requested once for the homepage and each newly published priority page;
- IndexNow is sent only for genuine publication, substantive change, or removal; and
- unchanged URLs are not repeatedly resubmitted because indexing is slow.

Submission time and resulting coverage state belong in the monthly visibility evidence.

## Visibility attribution

A short-lived Visibility Journey correlates discovery with product outcomes without becoming an
account or advertising profile. The approved funnel is:

1. `public_content_viewed`
2. `public_content_action_clicked`
3. `chat_request_accepted`
4. `reality_check_completed`
5. `travel_answer_admitted`

The first three and final events are target-state names; `reality_check_completed` already exists.
The final event may be emitted only after the applicable durable-admission boundary succeeds.
Anonymous response delivery is a separate onboarding diagnostic and must not be labeled a Travel
Answer.

The browser-to-server attribution envelope may contain only:

- Visibility Journey ID;
- source family and slug;
- action and surface; and
- coarse referrer class.

Prompts, message text, full referrer URLs, search queries, precise location, Clerk identifiers,
email, and other account or traveler content are prohibited. The server validates all dimensions,
uses the Visibility Journey ID as the analytics correlation identity, and removes it from event
properties. Do Not Track and fail-open product behavior remain enforced.

The rationale is recorded in
[ADR-0016](../../../docs/adr/0016-correlate-visibility-with-privacy-safe-journeys.md).

### Browser SDK boundary

The target architecture adds `posthog-js` as an explicit browser initialization boundary before
Visibility Journey capture. The client SDK does not replace the custom server sink: the browser
owns consent-aware public actions, while the server remains authoritative for request acceptance,
Reality Check completion, and durable Travel Answer admission.

Initialization must follow the installed Next.js version's `instrumentation-client.ts` guidance,
run before any browser SDK method, and remain optional when configuration is absent. Autocapture,
automatic pageviews, session replay, and account identification remain disabled because this
strategy permits only explicit allowlisted events and a short-lived, non-account correlation
identity. Do Not Track or missing consent prevents browser delivery. Migration tests must prove
that the SDK and custom server sink neither drop nor double-count events.

### PostHog enablement gate

Production analytics must remain disabled until all of the following are true:

1. PostHog event retention is reduced from 12 months to 90 days.
2. Evidence of the setting is retained.
3. The production vendor register records the satisfied gate.
4. The event and property allowlists cover the new funnel without admitting prohibited data.
5. Regression tests prove attribution continuity and the durable-admission ordering boundary.

No 12-month retention variance is approved for this strategy. Missing configuration or analytics
delivery failure must never block public content, chat, or Travel Answer admission.

## Evidence and target setting

Alex Metelli is the initial Visibility Owner. Before implementation claims improvement, the owner
must capture the current Search Console, Bing, backlink, indexing, and available analytics state.
Repository code cannot prove those external facts.

The 90-day outcome period begins only after the complete attribution seam is deployed to the
authorized production environment. Its first 28 days establish the behavioral baseline. Numerical
targets are approved after that baseline rather than inferred from the dated audit.

The monthly evidence review should keep these layers separate:

- priority-page index coverage;
- non-branded search impressions;
- genuine external evaluations and referring domains;
- attributable visits to decision pages and Worked Reality Checks; and
- Qualified Discovery culminating in Travel Answer admission.

## Delivery sequence and gates

The sequence prevents later evidence from being collected against an untrustworthy or
unattributable surface.

### 1. Refresh the baseline

Record current Google and Bing coverage, sitemap state, backlinks, referrals, and configured
analytics delivery. Treat unavailable evidence as a gap, not a pass.

**Exit evidence:** dated baseline with source links or exports and the exact production candidate.

### 2. Establish identity and trust

Publish the approved product identity, Accountable Editor profile, editorial method, corrections
contact, and AI-use disclosure. Remove unsupported local-review claims.

**Exit evidence:** rendered-page checks and structured-data validation for the deployed candidate.

### 3. Correct representations and metadata

Implement editorial dates, named author links, guide-specific social images, application schema,
canonical headers, raw-representation noindex policy, and substantive sitemap dates.

**Exit evidence:** response-header tests, HTML/schema tests, and browser-visible metadata proof.

### 4. Complete privacy-safe attribution

Satisfy the 90-day PostHog retention gate, propagate the Visibility Journey through chat, add the
approved event taxonomy, and emit conversion only after durable admission.

**Exit evidence:** adversarial tests showing that the same journey reaches the admitted event, that
premature completion cannot count, and that prohibited properties are rejected.

### 5. Publish differentiated evidence

Publish the first two Worked Reality Checks and the three initial decision pages. Each artifact must
meet its evidence contract and link deliberately among the pillar, example, and current chat path.

**Exit evidence:** editorial checklist, source review, rendered-page tests, and canonical sitemap
inclusion for each artifact.

### 6. Notify search engines

Submit only the new or substantively changed canonical URLs under the approved notification
contract.

**Exit evidence:** dated submission record followed by later coverage status; submission alone is
not an indexing pass.

### 7. Earn external corroboration

Seek five genuine evaluations within 90 days from relevant accommodations, surf professionals,
coworking spaces, transport operators, tourism organizations, or travel writers. An evaluation
counts only when the evaluator inspected the relevant product or content, consented to attribution,
and any commercial relationship is disclosed.

**Exit evidence:** the evaluation itself and its scope, not merely a backlink.

## Implementation tickets

All repository changes are delivered through pull requests because `main` is protected. The
approved work is split into these tickets:

1. [#223 — Capture the live visibility baseline and govern the 90-day evidence period](https://github.com/ametel01/ask-siargao/issues/223)
2. [#215 — Publish the Siargao Trip Copilot identity and accountable editor](https://github.com/ametel01/ask-siargao/issues/215)
3. [#216 — Correct public-page dates, schema, social images, and alternate representations](https://github.com/ametel01/ask-siargao/issues/216)
4. [#217 — Reduce PostHog retention to 90 days before production analytics](https://github.com/ametel01/ask-siargao/issues/217)
5. [#218 — Initialize the PostHog browser SDK for privacy-safe visibility journeys](https://github.com/ametel01/ask-siargao/issues/218)
6. [#219 — Propagate Visibility Journeys through durable Travel Answer admission](https://github.com/ametel01/ask-siargao/issues/219)
7. [#220 — Publish the first Worked Reality Checks as editorial artifacts](https://github.com/ametel01/ask-siargao/issues/220)
8. [#221 — Build the first constraint-led Siargao decision pages](https://github.com/ametel01/ask-siargao/issues/221)
9. [#222 — Implement evidence-preserving IndexNow notifications](https://github.com/ametel01/ask-siargao/issues/222)
10. [#224 — Earn five genuine external evaluations of Ask Siargao](https://github.com/ametel01/ask-siargao/issues/224)

Dependencies are recorded in the issue bodies. In particular, SDK initialization is blocked by the
retention gate, and durable attribution is blocked by SDK initialization.

## Non-goals

This strategy does not authorize:

- more crawler-specific files without a demonstrated need;
- repeated indexing submissions of unchanged URLs;
- purchased links, mass directory submissions, or paid favorable claims;
- fabricated authors, reviewers, credentials, or local relationships;
- publication of account-owned Travel Answers as editorial examples;
- account-level behavioral profiles for visibility measurement;
- safety guarantees or unsupported “live local” claims; or
- paid-offer schema while public paid checkout is unavailable.

Implementation remains subject to the existing Release Candidate, Release Evidence, privacy,
provider, and Launch Authorization boundaries.
