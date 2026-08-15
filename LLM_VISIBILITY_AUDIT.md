# Ask Siargao LLM and AI-Agent Visibility Audit

## Verdict

As of August 15, 2026, Ask Siargao is technically very accessible to AI crawlers, but practically almost undiscoverable.

| Surface | Assessment |
|---|---|
| AI agent given the URL | High visibility |
| Google/Bing discovery | No indexed pages observed |
| ChatGPT/Perplexity crawl eligibility | High |
| Existing LLM model knowledge | Effectively none—the site is new |
| Chance of unsolicited citation/recommendation today | Low |

My rough scores:

- Technical crawlability: **9/10**
- LLM-readable content: **8/10**
- Search discoverability: **1/10**
- Authority/trust signals: **4/10**
- Recommendation likelihood today: **2/10**

That gap is normal for a site submitted yesterday.

## What is already strong

The technical foundation is unusually good:

- [robots.txt](https://www.asksiargao.com/robots.txt) permits public crawling and advertises the sitemap.
- [sitemap.xml](https://www.asksiargao.com/sitemap.xml) contains 19 clean canonical URLs.
- Every sitemap URL I tested returned `200`, with a unique title, H1, description, and self-referencing canonical.
- Content is server-rendered HTML, so agents do not need JavaScript to understand it.
- GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Googlebot, and Bingbot user-agent tests all received full `200` responses.
- [llms.txt](https://www.asksiargao.com/llms.txt), Markdown versions, and public evidence APIs are already available.
- Guides use good headings, quick answers, tables, FAQs, direct sources, limitations, and structured data. The [complete guide](https://www.asksiargao.com/guides/complete-siargao-travel-guide) is particularly easy for an agent to parse.

The `llms.txt` work is useful, but it is a bonus—not a substitute for search indexing, external links, or authority.

## Why it is not visible yet

A Google `site:asksiargao.com` search currently says that no documents match. Bing also showed no result. `site:` searches are not definitive; Search Console’s URL Inspection report is the authoritative Google status.

This is not alarming after one day. Google says crawling may take several days to several weeks, repeated indexing requests do not accelerate it, and submission does not guarantee inclusion. [Google’s recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl) confirms this.

The larger long-term issue is authority. Exact-domain searches found no meaningful third-party mentions or links, while competing Siargao guides have established domains, named authors, publication histories, and outside references.

## Highest-impact improvements

### 1. Finish search-engine discovery

Today:

- Submit `https://www.asksiargao.com/sitemap.xml` in Google Search Console.
- Request indexing for only the homepage and 3–5 priority pages:
  - Complete travel guide
  - First-timer guide
  - Best time to visit
  - Five-day itinerary
  - General Luna guide
- Use URL Inspection’s live test to verify rendered content and Google-selected canonical.
- Verify Bing Webmaster Tools, submit the sitemap, and implement [IndexNow](https://www.indexnow.org/documentation) for genuinely new or changed pages.
- Do not repeatedly resubmit unchanged URLs.

Make sure sitemap `lastmod` values change only after substantive edits; Google uses them only when consistently accurate. [Google’s sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

### 2. Explicitly define what the product is

The homepage never clearly says “AI travel planner” or “AI-powered travel assistant.” An LLM cannot confidently categorize or recommend a product whose category remains implicit.

Add a plain statement near the H1, such as:

> Ask Siargao is an AI-powered Siargao travel-planning assistant that combines current public information, local planning context, and explicit limitations to reality-check itineraries, stays, transport, weather-dependent activities, and disruptions.

Also add `WebApplication` or `SoftwareApplication` structured data with:

- `name`
- `description`
- `applicationCategory`
- `operatingSystem: Web`
- `offers`
- `featureList`
- canonical URL

Keep the existing `WebSite` and `Organization` entities.

### 3. Make authorship and local expertise verifiable

The guides say “Ask Siargao Editorial Desk” and “Local Knowledge Review,” but neither identifies an accountable person or explains the claimed local connection.

Create:

- An About page
- Named author and reviewer profiles
- Relevant experience and relationship to Siargao
- Editorial/research methodology
- Corrections and contact information
- Disclosure of how AI assists content production, if applicable
- `Person` schema, author profile URLs, and truthful `sameAs` links

Google explicitly encourages clear authorship, author backgrounds, first-hand experience, and transparent creation methods. [People-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

### 4. Improve article metadata

The guides visibly show “Last checked,” but their `Article` JSON-LD lacks:

- `datePublished`
- `dateModified`
- an author profile URL

Add both dates in ISO 8601 format and render the visible date using `<time datetime="…">`. Google recommends these fields for understanding article dates and authors. [Article structured-data documentation](https://developers.google.com/search/docs/appearance/structured-data/article).

Also use each guide’s actual image for its Open Graph image; currently guides appear to share the generic sunset image despite having guide-specific schema images.

### 5. Build pages that demonstrate the product

Publish several ungated, fully worked examples:

- Reality-checking Cloud 9 against weather and tide
- A Siargao trip without a scooter
- Replacing a cancelled island tour
- Evaluating General Luna versus Pacifico
- Handling a late flight or ferry arrival

Show the question, inputs checked, sources, timestamp, bounded recommendation, limitations, and fallback. This gives agents concrete evidence of what Ask Siargao does rather than relying on marketing claims.

### 6. Earn corroboration outside the domain

This is likely the biggest factor in eventually being recommended.

Seek genuine editorial links from:

- Siargao accommodations
- Surf schools and instructors
- Coworking spaces
- Local transport or tourism organizations
- Philippine travel publications
- Local community sites
- Writers or reviewers who actually test the tool

Point links to the most relevant guide or example, not always the homepage. Avoid purchased links and mass directory submissions.

### 7. Expand differentiated, question-specific coverage

Prioritize queries where the product has a genuine advantage:

- Siargao without a scooter
- General Luna versus Pacifico
- Siargao rainy-day itinerary
- Siargao airport to General Luna
- Late arrival at Dapa Port
- Magpupungko tide planning
- Family itinerary
- Remote-work connectivity
- What to book versus keep flexible

The “Complete Travel Guide” currently concentrates on itinerary structure and transport. Either broaden it into a genuinely comprehensive pillar page or rename it more precisely and link it to supporting guides.

## AI-crawler specifics

For ChatGPT Search, `OAI-SearchBot` matters; `GPTBot` concerns possible model training and can be controlled separately. Your current wildcard rules allow both. OpenAI says allowing OAI-SearchBot makes content eligible for summaries, citations, and links, but does not guarantee selection. [OpenAI publisher guidance](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq).

Your configuration also permits PerplexityBot, matching [Perplexity’s crawler guidance](https://docs.perplexity.ai/docs/resources/perplexity-crawlers). Explicit per-bot `Allow` rules are unnecessary unless you later introduce broader blocking or WAF rules.

For the Markdown and public JSON alternatives, consider sending an HTTP canonical `Link` header pointing to the human HTML page. If raw Markdown/API URLs begin appearing in search, add `X-Robots-Tag: noindex` while leaving them crawlable for agents.

## What to expect

- Initial Google crawl/indexing: commonly days to weeks.
- Meaningful search impressions: usually weeks, assuming useful query alignment.
- Regular LLM citations: generally require indexing plus external authority.
- Unsolicited brand recommendations: more likely a months-long authority-building outcome than an indexing event.

The site does not need more “AI SEO files” right now. It needs indexing, an explicit product identity, verifiable human/local expertise, worked examples, and credible external references.
