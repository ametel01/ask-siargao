# Ask Siargao SEO Research

**Research date:** 2026-08-14

**Scope:** Current first-party guidance from Google Search Central, Google Business Profile,
Bing Webmaster, Schema.org, Chrome/web.dev, and Google Search Console; a live production and
repository audit; and a dated, non-personalized web-search sample of Siargao tourism competitors.

## Executive Summary

Ask Siargao should treat SEO as a public knowledge product, not as a programmatic page-volume
exercise. The strongest first-party guidance favors useful, original, independently curated content
with visible evidence, clear ownership, accurate freshness, crawlable internal links, and strong page
experience. Google says its normal SEO practices also apply to AI Overviews and AI Mode, while Bing
now exposes AI citations and grounding queries in Webmaster Tools. Neither vendor promises rankings
or citations from special markup or an AI-specific optimization technique.

The highest-leverage work for the current app is page-specific metadata, a browseable internal-link
architecture, visible update and source information, intentionally chosen structured data, relevant
travel imagery, and field measurement. Ask Siargao's existing public-page sitemap, canonical URL
model, evidence summaries, and server-rendered text are useful foundations.

The production bottleneck is more fundamental than markup. On 2026-08-14, the sitemap was empty,
the public knowledge URLs sampled returned `404`, and neither the home page nor the app surfaces
linked to a crawlable tourism-content graph. Ask Siargao did not appear in this research tool's
sampled Siargao tourism results. Metadata and schema improvements will matter only after the site
publishes substantial, accessible, internally linked pages that answer traveler questions without
requiring a chat interaction.

## Authoritative Findings

### 1. Publish first-hand, evidence-backed travel content

- Google says its systems prioritize helpful, reliable content created for people. Its assessment
  questions emphasize original reporting or analysis, substantial value beyond source rewriting,
  clear sourcing, author or site background, demonstrated first-hand expertise, and a focused site
  purpose. Visiting a place is Google's own example of first-hand expertise.
  [Google: creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- Google warns that generating many pages primarily for rankings, including with generative AI,
  without adding value can be scaled content abuse. It also identifies substantially similar doorway
  pages that funnel visitors onward as abusive.
  [Google: spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- Google's current generative-AI guidance says normal SEO fundamentals remain applicable to AI
  Overviews and AI Mode. A page must be indexed and eligible to show a snippet, and there are no
  additional technical requirements or special optimizations for inclusion.
  [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- Google separately advises against creating pages for every possible query variation to manipulate
  rankings or generative answers. It recommends useful content plus relevant, high-quality images and
  video.
  [Google: optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- For Google's Top Places List feature, an editorial list must be genuinely curated, independent,
  unsponsored, and not composed of templated sentences generated from data or automated metrics.
  [Google: Top Places List](https://developers.google.com/search/docs/appearance/top-places-list)
- Paid or advertising links should use `rel="sponsored"`; Google recommends `rel="ugc"` for links
  placed in user-generated content.
  [Google: qualify outbound links](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links)

**Inference for Ask Siargao:** Build fewer, decision-complete pages around real traveler jobs such as
choosing an area, reaching a beach, finding a clinic, or planning an evidence-backed evening. Each
page should state who checked it, what the evidence is, when the important facts were checked, and
what remains uncertain. Do not mass-produce near-duplicate pages for every adjective, neighborhood,
or query variation. Keep paid placements outside independent "best" lists, disclose the commercial
relationship, and qualify paid links.

### 2. Make every valuable public page discoverable without relying on the sitemap alone

- Google says it generally discovers links through `<a>` elements with an `href`. Every page a site
  cares about should be linked from at least one other page, using concise, descriptive anchor text.
  [Google: link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- Google's Search Essentials recommends putting the words people use to find the content in prominent
  locations such as the title, main heading, alt text, and link text.
  [Google: Search Essentials](https://developers.google.com/search/docs/essentials)
- Google recommends logical site organization, descriptive URLs, and topical grouping. Its developer
  guide says all important URLs should be reachable from another findable page and that sitemaps help
  discovery but complement links.
  [Google: SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
  [Google: developer guide](https://developers.google.com/search/docs/fundamentals/get-started-developers)
- Google can render JavaScript, but server-side rendering or pre-rendering remains recommended because
  it is faster for users and crawlers and because not every bot executes JavaScript. Text that matters
  should be accessible in the DOM.
  [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- Google indexes from the mobile version of a site. It recommends responsive design, equivalent
  primary content and metadata on mobile and desktop, and avoiding primary content that loads only
  after a user clicks, swipes, or types.
  [Google: mobile-first indexing](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)
- Google says a sitemap should contain fully qualified canonical URLs that the site wants in Search.
  Sitemap inclusion is a weaker canonical signal than redirects or `rel="canonical"`, and these signals
  can reinforce each other.
  [Google: build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
  [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- Google uses sitemap `lastmod` only when it is consistently accurate; it should represent a
  significant change to the main content, structured data, or links rather than an automatic date
  refresh.
  [Google: sitemap `lastmod`](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap#xml)

**Inference for Ask Siargao:** Add crawlable area and topic hubs with contextual links among areas,
accommodations, operators, risks, and routes. Keep the existing sitemap limited to approved canonical
HTML pages and preserve meaningful `lastmod` values. A public page should never be discoverable only
through `/sitemap.xml`, an API response, or `llms.txt`.

### 3. Give every public page distinct search-result metadata

- Google recommends a descriptive, concise, distinct `<title>` for every page and warns against vague,
  repeated, boilerplate, or keyword-stuffed titles. The visible main heading should make the primary
  topic unambiguous.
  [Google: title links](https://developers.google.com/search/docs/appearance/title-link)
- Google primarily creates result snippets from page content but may use a page's meta description
  when it is more accurate. It recommends unique descriptions that summarize the specific page.
  [Google: snippets and meta descriptions](https://developers.google.com/search/docs/appearance/snippet)
- Google says `WebSite` structured data on the home page is the most important on-site way to express a
  preferred site name. Consistency with the home-page title, headings, and `og:site_name` also matters.
  [Google: site names](https://developers.google.com/search/docs/appearance/site-names)
- Google recommends Organization markup on the home page or a single organization/about page, using
  only applicable identity properties such as name, URL, logo, and real-world or online presence.
  [Google: Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization)
- Breadcrumb markup can communicate a page's place in a typical user path and can make pages eligible
  for breadcrumb presentation in desktop Search.
  [Google: Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)

**Inference for Ask Siargao:** Generate a canonical URL, specific title, specific description, and
social preview for every indexable knowledge page. Add consistent `WebSite` and truthful Organization
identity on the home page, then pair visible breadcrumbs with `BreadcrumbList` on nested knowledge
pages. The repository's current root-level title and description are too generic to serve as inherited
metadata for all dynamic public pages.

### 4. Treat structured data as an accurate description, not a ranking promise

- Google recommends JSON-LD but says markup must accurately represent the page's visible main content.
  Markup must be complete for the selected Google feature, must not be misleading, and does not
  guarantee a rich result.
  [Google: structured data introduction](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
  [Google: general structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- Google explicitly says Schema.org contains types and properties beyond those it uses for rich
  results; Google Search Central, not Schema.org alone, is definitive for Google feature behavior.
  [Google: structured data introduction](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data#format)
- Schema.org provides applicable semantic types including
  [`TouristDestination`](https://schema.org/TouristDestination),
  [`TouristAttraction`](https://schema.org/TouristAttraction),
  [`LocalBusiness`](https://schema.org/LocalBusiness),
  [`Hotel`](https://schema.org/Hotel), and
  [`TouristTrip`](https://schema.org/TouristTrip). `TouristTrip` is currently identified by Schema.org
  as a newer term seeking implementation feedback.
- Google's vacation-rental rich-result integration is not a general directory feature. Its guidance
  is intended for sites already connected to a Google Technical Account Manager and Hotel Center, and
  eligibility requires additional integration steps.
  [Google: VacationRental structured data](https://developers.google.com/search/docs/appearance/structured-data/vacation-rental)
- Google's Event experience requires a unique leaf URL focused on a single event, accurate local time
  and location data, and a publicly attendable physical event. The currently documented supported
  regions do not include the Philippines.
  [Google: Event structured data](https://developers.google.com/search/docs/appearance/structured-data/event)
- For review snippets about a local business or organization, ratings must come directly from users;
  editorially compiled ratings do not qualify. Self-controlled reviews for the reviewed organization
  are ineligible for the star feature.
  [Google: review snippet structured data](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)

**Inference for Ask Siargao:** Keep `WebPage` as a safe baseline and add a more specific main entity
only when the visible content and stored facts support it. Schema.org tourism types may improve entity
clarity for consumers that understand them, but they should not be represented internally as Google
rich-result entitlements. `TouristDestination` can model an area and its attractions, while
`TouristTrip` can model a real itinerary. Do not add vacation-rental, review, rating, or event markup
from partial, derived, or stale provider data. If individual verified events eventually receive stable
public leaf pages, valid Event semantics may still be useful even though Google's documented
Philippines event experience is not currently available.

### 5. Keep local-business identity and third-party place facts separate

- Google Business Profiles are for businesses that make in-person contact with customers during their
  stated hours. Online-only businesses, lead-generation companies, and individual properties for rent
  or sale are ineligible.
  [Google Business Profile: eligibility and ownership](https://support.google.com/business/answer/13763036)
- For eligible storefront or service-area businesses, a verified Business Profile can maintain hours,
  website, phone, location or service area, photos, and reviews in Google Search and Maps.
  [Google Business Profile: get started](https://support.google.com/business/answer/7039811)
- Schema.org defines `LocalBusiness` as a particular physical business or branch, not as a generic page
  about somebody else's business.
  [Schema.org: LocalBusiness](https://schema.org/LocalBusiness)

**Inference for Ask Siargao:** Claim a Google Business Profile only if Ask Siargao develops an eligible
face-to-face customer operation. Do not create or control profiles for recommended venues without
authorization, and do not mark Ask Siargao itself as a `LocalBusiness` merely because it publishes
local information. On venue pages, distinguish the publisher (`Organization`) from the described
place (`LocalBusiness`, `Hotel`, `Restaurant`, or another applicable type).

### 6. Use images as travel information, not decoration

- Google recommends relevant, representative, high-resolution images and warns against generic logos,
  text-heavy images, and extreme aspect ratios for structured data or `og:image` candidates.
  [Google: image SEO best practices](https://developers.google.com/search/docs/appearance/google-images)
- Bing's current Webmaster Guidelines say images and video should reinforce, not replace, the primary
  text and should have descriptive filenames, alt text, captions or transcripts, or accurate structured
  data.
  [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)

**Inference for Ask Siargao:** Add licensed, location-specific hero and supporting images to priority
pages, with stable crawlable URLs, dimensions, useful alt text, and a representative social image.
Photos should help a traveler judge terrain, atmosphere, access, or suitability; generic island stock
imagery adds little evidence or differentiation.

### 7. Optimize for real mobile experience and measure it in the field

- The stable Core Web Vitals are LCP, INP, and CLS. web.dev recommends assessing the 75th percentile of
  visits, segmented by mobile and desktop.
  [web.dev: Web Vitals](https://web.dev/articles/vitals)
- The current "good" thresholds are LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and
  CLS at or below 0.1.
  [web.dev: LCP](https://web.dev/articles/lcp)
  [web.dev: INP](https://web.dev/articles/optimize-inp)
  [web.dev: CLS](https://web.dev/articles/optimize-cls)
- Google uses Core Web Vitals in ranking systems but says good scores do not guarantee top rankings.
  Overall page experience also includes secure delivery, mobile usability, non-intrusive interfaces,
  and a clear distinction between main and secondary content.
  [Google: page experience](https://developers.google.com/search/docs/appearance/page-experience)
- Lab tools cannot fully substitute for field data: Lighthouse cannot measure INP without real user
  input and uses Total Blocking Time as a laboratory proxy.
  [web.dev: Web Vitals measurement](https://web.dev/articles/vitals#lab_tools_to_measure_core_web_vitals)

**Inference for Ask Siargao:** Establish mobile field monitoring before adding heavy maps, image
carousels, or chat widgets to public landing pages. Use the thresholds as product guardrails, not as a
promise of rank. Reserve image and embed space to avoid CLS, keep the main answer server-rendered and
early in the response, and test route transitions and interactive controls for INP.

### 8. Use Bing's discovery and AI-visibility tooling alongside Google

- Bing recommends both sitemaps for comprehensive discovery and IndexNow notifications when URLs are
  added, updated, or deleted. IndexNow does not replace the sitemap.
  [Bing: sitemaps in AI-powered search](https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search)
- Bing specifically lists destination and hotel additions or removals, travel deals, destination-guide
  updates, significant review changes, and new or removed articles as travel cases for IndexNow. A
  successful IndexNow response acknowledges receipt and does not guarantee indexing.
  [Bing: when to use IndexNow](https://blogs.bing.com/webmaster/September-2024/IndexNow-When-and-How-Websites-Should-Notify-Search-Engines)
  [IndexNow protocol](https://www.indexnow.org/documentation)
- Bing's current Webmaster Guidelines emphasize crawlable and renderable content, clear semantic HTML,
  accurate structured data, explicit verifiable facts, consistent entity names, one primary topic per
  URL, early placement of key information, current content, stable URLs, and reduced crawl waste. They
  also state that neither SEO nor generative-engine optimization guarantees traffic or citations.
  [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)
- Bing Webmaster Tools' AI Performance public preview reports total citations, cited pages, sampled
  grounding queries, page-level citation activity, and trends across Microsoft Copilot, Bing AI
  summaries, and selected partner integrations. Microsoft cautions that citation counts do not indicate
  ranking, authority, placement, or a page's role in an answer.
  [Bing: AI Performance](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview)
- Bing's URL Inspection tool exposes index, crawl, SEO, and markup status and can show the live response
  Bingbot sees.
  [Bing: URL Inspection](https://www.bing.com/webmasters/help/URL-Inspection-55a30305)

**Inference for Ask Siargao:** Verify the production property in Bing Webmaster Tools, submit the
sitemap, and add IndexNow after URL publication and freshness workflows are reliable. Monitor AI
citations and grounding-query samples as a separate visibility signal, not as conversion or ranking
data.

### 9. Measure search discovery separately from on-site outcomes

- Google identifies Search Console as the source of truth for Google Search performance and an
  analytics system as the source of truth for behavior inside the site. Clicks and sessions use
  different definitions and should not be expected to match exactly.
  [Google: Search Console and Analytics for SEO](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console)
- Search Console's Performance report supports page, query, device, country, click, impression, CTR,
  and position analysis. Google recommends focusing more on trends in impressions and clicks than on
  average position alone.
  [Search Console: Performance report tasks](https://support.google.com/webmasters/answer/17010961)

**Inference for Ask Siargao:** Track an SEO funnel from indexed canonical page to impression, click,
useful engagement, chat start, and paid conversion. Segment public page families and mobile traffic.
Use Search Console and Bing Webmaster data for discovery and citation measurement, then use the
product's own consent-respecting analytics for traveler outcomes.

## Live Production And Repository Audit

### Method and limits

The observations below were recorded on 2026-08-14 against `https://asksiargao.com` and the current
repository. HTTP responses and rendered HTML were inspected directly. Two Lighthouse runs used
mobile emulation against the production home page, followed by one desktop run. Lighthouse lab
results varied materially by run and are not
Chrome User Experience Report field data. The PageSpeed Insights API returned a daily-quota error, so
this review does not claim a production Core Web Vitals field pass or fail. Google Search Console,
Bing Webmaster Tools, backlink, and first-party keyword-volume data were not available.

### What is working

- `https://asksiargao.com/` permanently redirects to the consistent `www` host, which returned `200`.
- The home page's main message, headings, and links are present in server-rendered HTML. It has one
  clear H1 and does not require JavaScript merely to expose its primary copy.
- The repository has dedicated robots, XML sitemap, public HTML, Markdown, JSON, and `llms.txt`
  routes. It also has a public-page eligibility layer intended to keep private or non-republishable
  facts out of public pages.
- The public-page component can render visible freshness, confidence, limitations, and JSON-LD.
  This provenance model could become a genuine editorial differentiator once real public pages are
  available.
- Both Lighthouse mobile lab runs reported accessibility `100`, best practices `96`, and CLS `0`.
  The desktop run reported performance `96`, LCP `1.0 s`, and CLS `0`. These are encouraging lab
  signals, not field guarantees.

### Blocking and high-priority findings

1. **The production sitemap is empty.** `https://www.asksiargao.com/sitemap.xml` returned `200` but
   contained an empty `<urlset>`. `llms.txt` likewise contained no page entries. The production
   knowledge URLs sampled under `/areas/`, `/routes/`, `/accommodations/`, `/operators/`, and
   `/risks/` all returned `404`. This means the repository's content model is not currently supplying
   an indexable tourism corpus.
2. **The robots sitemap directive is relative.** Production serves `Sitemap: /sitemap.xml`.
   Lighthouse marked that line invalid; Google documents the robots directive with a fully qualified
   sitemap URL, and its sitemap guidance requires absolute URLs.
   [Google: robots.txt sitemap directive](https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt)
   [Google: build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
3. **Metadata is generic or absent.** The home page, `/chat`, and `/sign-in` all rendered the title
   `Ask Siargao`; the home page description is generic. The home page had no explicit canonical,
   Open Graph, or Twitter-card metadata in the rendered head. Dynamic public routes do not implement
   page-specific metadata in their route files or shared renderer.
4. **No crawlable tourism navigation exists.** The home page primarily links to chat, settings, and
   legal or in-page destinations. It does not link to area, route, accommodation, operator, risk,
   itinerary, attraction, restaurant, or transport hubs. Even after the sitemap is populated, this
   would leave important pages weakly connected for users and crawlers.
5. **App and authentication indexing is not intentional.** `/chat` and `/sign-in` returned `200`
   without a robots meta directive in the sampled HTML, while logged-out `/settings` and missing
   public pages returned a Next.js `noindex` 404. Decide which app surfaces have standalone search
   value and add `noindex` to account, authentication, private-trip, and thin interactive pages that
   should not appear in results.
   [Google: robots meta tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
6. **The public page template is too thin for competitive travel queries.** Its visible body is a
   list of claim cards plus freshness, confidence, and limitations. That is useful evidence, but it
   does not yet provide the complete comparisons, logistics, maps, photos, trade-offs, FAQs, and
   related links seen on competing pages.
7. **Structured data is not creating a current search feature.** The repository builds a generic
   `WebPage` with a `Thing` main entity and `Claim` objects, but the sampled public routes are not live.
   Even when published, this markup is primarily semantic; it is not one of Google's documented
   tourism rich-result entitlements.
8. **The home-page LCP needs field follow-up.** The two Lighthouse mobile lab runs scored performance
   `85` and `94`, with LCP values of `3.9 s` and `2.8 s`; SEO was `91` in both. The desktop run scored
   performance `96` with LCP `1.0 s`. The mobile LCP was the hero image; Lighthouse reported that its
   preload lacked `fetchpriority=high`. The variance reinforces the need for real-user data before
   treating the page as a Core Web Vitals pass or fail.
9. **Two production polish defects are visible to visitors and crawlers.** The landing page links to
   `/settings#pass`, but a signed-out request returns a `404`. Lighthouse also logged a `404` for
   `/favicon.ico`, which contributed to the best-practices score of `96`. Fix the broken destination
   or gate the link, and ship standard favicon/app icon metadata.

## Current Siargao Search Landscape

### How to read this sample

These are observed result orders from the web-search tool on 2026-08-14, not a claim about stable
Google positions. Results can vary by search engine, country, device, language, personalization, and
time. The sample is useful for identifying result types and recurring competitors; it does not
establish keyword volume, ranking causality, backlink strength, or conversion value.

| Query sampled | Leading results observed | Result-shape observation |
| --- | --- | --- |
| `Siargao travel guide` | [Travela Siargao](https://www.travelasiargao.com/stories/complete-siargao-travel-guide-first-timers), [Wikivoyage](https://en.wikivoyage.org/wiki/Siargao), [TaraTrips](https://www.taratrips.com/destinations/siargao), [Travel + Leisure](https://www.travelandleisure.com/siargao-philippines-travel-guide-8728773), and the [Philippine tourism department](https://www.tourism.gov.ph/destination/caraga/siargao-island/) | Broad guides mix current logistics, area selection, attractions, food, and trip planning. Authority ranges from official and major publishers to local commercial operators. |
| `things to do in Siargao` | [Philippine tourism department](https://www.tourism.gov.ph/destination/caraga/siargao-island/), [Globe](https://www.globe.com.ph/blog/things-to-do-in-siargao), [Tripadvisor](https://www.tripadvisor.com/Attractions-g674645-Activities-Siargao_Island_Surigao_del_Norte_Province_Mindanao.html), and [Golden Bell](https://goldenbellsiargao.com/blog/things-to-do-siargao/) | Official destination authority, a large Philippine brand, review inventory, and asserted local first-hand expertise all compete. |
| `where to stay in Siargao` | [VisitSiargao.com](https://visitsiargao.com/places-to-stay), [Siargao Local](https://www.siargaolocal.com/blog/where-to-stay-in-siargao/), [Hotels Philippines](https://hotels-philippines.com/blog/where-to-stay-in-siargao/), and [Siargao Finder](https://www.siargaofinder.com/blog/where-to-stay-in-siargao) | Pages segment by area and traveler type, state trade-offs, and connect editorial advice to accommodation or booking inventory. |
| `Siargao restaurants` | [Tripadvisor](https://www.tripadvisor.com/Restaurants-g674645-Siargao_Island_Surigao_del_Norte_Province_Mindanao.html), [Kawayan Villa](https://kawayanvillasiargao.com/blog-where-to-eat-siargao-2026.html), [Siargao Finder](https://www.siargaofinder.com/blog/best-restaurants-in-siargao), and [Condé Nast Traveller Middle East](https://www.cntravellerme.com/story/where-to-eat-in-siargao-the-philippines-emerging-foodie-hotspot) | Live review platforms, hospitality operators, directories, and editorial publishers compete with category and dietary segmentation. |
| `Siargao itinerary` | [Kawayan Villa](https://kawayanvillasiargao.com/blog-siargao-itinerary.html), [Siargao Finder](https://www.siargaofinder.com/blog/siargao-itinerary), [Siargao Local](https://www.siargaolocal.com/blog/siargao-5-day-itinerary/), and [Go to Philippines](https://www.go-to-philippines.com/3-days-in-siargao/) | Strong pages offer distinct 3-, 5-, and 7-day plans, realistic transit time, quick answers, practical prices, and FAQs. |
| `Siargao rainy day activities` | [Tripadvisor](https://www.tripadvisor.com/Attractions-g674645-Activities-zft11295-Siargao_Island_Surigao_del_Norte_Province_Mindanao.html), [Siargao.ph](https://www.siargao.ph/2025/09/rainy-day-wonders-what-to-do-in-siargao.html), and [GetYourGuide](https://www.getyourguide.com/siargao-island-l149944/rainy-day-activities-tc269/) | The results are thinner and more aggregator-led than the core guides. A genuinely checked, weather-aware fallback guide is a plausible differentiation opportunity, subject to demand validation. |

The tool did not return Ask Siargao for the sampled non-brand tourism queries or for the attempted
`site:asksiargao.com`/brand checks. This observation is consistent with the empty production sitemap
and missing public pages, but it is not proof of Google's index state; only Search Console's indexing
reports and URL Inspection can establish that for Google.

### Recurring competitor strengths

- **Fresh framing and clear ownership:** winning-looking pages prominently show 2026 dates, read
  times, author or team attribution, and sometimes first-person local operating experience.
- **Decision-complete structure:** quick answers, area or traveler-type comparisons, realistic travel
  time and price ranges, caveats, category tables, FAQs, and related links reduce the need to return
  to the results page.
- **Topical depth:** competitors publish connected clusters for guides, itineraries, areas,
  attractions, transport, stays, restaurants, and surf rather than isolated landing pages.
- **Commercial utility:** directories, accommodation providers, tour sellers, and review platforms
  connect information to current inventory, booking, or contact actions.
- **Recognizable authority:** government tourism pages, large publishers, Tripadvisor, and strong
  local brands bring signals Ask Siargao cannot reproduce with metadata alone.

These patterns are correlations in the observed pages, not proof that any one feature caused a rank.
Ask Siargao's defensible opportunity is not another generic “best of Siargao” corpus. It is
constraint-aware advice backed by checked sources and request-time evidence, with honest uncertainty
and a practical fallback.

## Recommended Search Architecture And Sequence

### Priority query and page clusters

1. **Destination foundations:** a Siargao travel-guide hub, first-timer guide, things-to-do hub,
   best-time-to-visit guide, and linked municipality/area guides. These are competitive but necessary
   for a coherent destination graph.
2. **Where to stay by constraint:** General Luna versus quieter areas; no-scooter accessibility;
   families; remote work and power/internet reliability; surf access; quiet sleep; and budget. Each
   page must be based on supported facts, not adjective-swapped templates.
3. **Transport and arrival:** Sayak Airport to General Luna, Surigao City to Dapa ferry planning,
   Dapa onward transport, getting around without a scooter, and late-arrival fallbacks. Schedule and
   price claims need visible checked dates and primary-source links.
4. **Weather and disruption:** rainy-day activities, seasonal weather, tide-dependent attractions,
   and “what to do when today's plan fails.” Keep stable explanatory content indexable and clearly
   distinguish it from request-time conditions.
5. **Constraint-aware itineraries:** realistic 3-, 5-, and 7-day plans with transit buffers, rain
   fallbacks, family/no-scooter variants, and links into a live reality check.
6. **Food and local businesses:** verified restaurant and café discovery by area, dietary need,
   opening-time confidence, and group type. Keep independent editorial lists separate from paid
   placements and do not synthesize ratings from provider data.
7. **Surf and safety:** beginner logistics, area and season explainers, tide/wind caveats, local
   instruction, and explicit limits on real-time safety advice.

### Delivery sequence

**P0 — establish an indexable product**

1. Make the production public catalog reliably serve a small initial set of substantial `200` HTML
   pages. Do not launch hundreds of fixture-like pages.
2. Build crawlable destination and topic hubs, link every public page contextually, and expose the
   hubs from the home page or primary navigation.
3. Populate the XML sitemap with only canonical, indexable `200` pages, include accurate `lastmod`,
   use the absolute `https://www.asksiargao.com/sitemap.xml` robots directive, and submit it to Google
   Search Console and Bing Webmaster Tools.
4. Add unique metadata, explicit canonicals, social previews, site-name/Organization identity, and
   an intentional `index`/`noindex` policy for all routes.
5. Verify representative URLs with Google and Bing inspection tools before scaling publication.

**P1 — earn relevance and trust**

1. Publish the foundation, transport, accommodation-constraint, weather-fallback, and itinerary
   clusters with named editorial responsibility, visible checked dates, linked sources, and useful
   local photography.
2. Expand the public template from claim cards into decision-complete pages with summaries,
   comparisons, logistics, maps or location context, caveats, FAQs, and related pages.
3. Add conservative `WebSite`, Organization, `BreadcrumbList`, and page-appropriate entity markup,
   validating both syntax and visible-content parity.
4. Fix the hero-image LCP path, establish mobile field monitoring, and set route-level performance
   budgets before adding heavy maps or widgets.

**P2 — build authority and operating discipline**

1. Earn links and mentions through original local data, genuinely useful tools, operator or community
   partnerships, and citable reports rather than paid link schemes.
2. Add IndexNow only after publication and update events are trustworthy; monitor Bing AI citations
   separately from rankings and conversions.
3. Run a governed refresh queue for schedules, prices, hours, closures, weather-sensitive facts, and
   stale pages. Change dates only when the main content meaningfully changes.
4. Review Search Console queries, pages, countries, and devices monthly, then prioritize content by
   impressions, engagement, chat starts, and commercial outcomes rather than guessed keyword lists.

No source can promise that this sequence will make Ask Siargao “rank highly.” It removes current
technical blockers and aligns the site with the qualities repeatedly visible in official guidance and
the sampled competitive results.

## Concise Implications For Ask Siargao

1. **Publish real public pages before polishing markup.** Production currently has an empty sitemap
   and the sampled knowledge URLs return `404`; ranking cannot begin without a useful crawlable corpus.
2. **Build browseable hubs and contextual links.** Connect every approved page from at least one
   useful HTML page; keep a non-empty canonical sitemap as supporting discovery infrastructure.
3. **Ship page-specific metadata.** Dynamic public pages need unique title, description, canonical,
   social image, and visible H1 alignment; private app and account flows need an intentional policy.
4. **Turn provenance into editorial value.** Show checked dates, source names or links, authorship or
   review responsibility, confidence, and limitations where travelers can see them.
5. **Favor a small, differentiated content graph.** Publish decision-complete pages from real island
   knowledge and live evidence; reject mass query-variant pages and generic AI summaries.
6. **Use structured data conservatively.** Add `WebSite`, Organization, breadcrumbs, and truthful
   page-specific entities; do not imply ownership, ratings, availability, or Google feature eligibility.
7. **Make travel pages visually useful and fast.** Use licensed, specific imagery while holding the
   75th-percentile targets of LCP <= 2.5 s, INP <= 200 ms, and CLS <= 0.1.
8. **Instrument both search ecosystems.** Verify Google Search Console and Bing Webmaster Tools,
   submit the sitemap to each, then consider IndexNow and Bing AI Performance monitoring.
9. **Evaluate outcomes, not schema volume.** Measure indexed pages, non-brand impressions, clicks,
   engaged visits, chat starts, and conversions by page family; treat rankings and AI citations as
   intermediate signals.

## Repository Context Reviewed

This research was mapped against the current root metadata, dynamic public knowledge routes, public
page renderer, robots route, sitemap route, and JSON-LD builder. Repository observations in this note
are implementation-context inferences, not claims made by the external sources. The competitor sample
records observed web-search results as of the research date and does not imply stable rankings.
