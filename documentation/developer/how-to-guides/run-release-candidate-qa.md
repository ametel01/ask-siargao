# Run Release-Candidate QA

Use this checklist before treating the current build as a release candidate.

## Automated Gates

Run the full gate suite from a clean working tree or after reviewing intentional local changes.

```sh
bun run verify:ci
```

`bun run verify:ci` mirrors the CI release gate: lint, clean typecheck, Bun tests, test database migrate/seed, build, and Playwright e2e. `bun run verify` runs the fast non-mutating local subset. Use `bun run format` only when you want Biome to write formatting fixes. React Doctor runs in a separate advisory GitHub workflow and is available locally with `bun run doctor`.

## Manual Product QA

- Landing page visually matches the dark coastal Ask Siargao direction in `design/web-landing.png` and `docs/LANDING_STYLE_REQUIREMENTS.md`.
- Landing page has no horizontal overflow at 390, 768, 1024, and 1366 pixel widths.
- Landing page includes the Ask Siargao headline, example prompt card, `Today in Siargao` weather card, suggestion chips, trust row, and bottom feature cards.
- `/chat` visually matches the desktop three-column assistant workspace in `design/web-chat-page.png`.
- `/chat` renders the mobile chat layout with top bar, trip-context pill, conversation body, recommendation cards, and sticky composer.
- Incomplete or low-confidence audits remain blocked from checkout.
- Checkout handoff only starts from a complete, eligible audit state.
- Returning from Checkout does not unlock a report by itself; the verified Stripe webhook is the unlock boundary.
- Final report shows overall risk, top risks, category table, evidence IDs, freshness notes, host questions, and limitations.
- Report generation and reviewer flows are exercised with mocked OpenAI clients in tests.

## Public And Agent-Readable QA

- Human public pages, LLM Markdown, JSON APIs, JSON-LD, sitemap, and `llms.txt` all use the same fact records.
- Public pages include freshness, confidence, source type, canonical URL, and limitations.
- Public eligibility blocks private paid-report facts, user inputs, raw provider payloads, non-republishable facts, low-confidence facts, and weak entity matches.
- `/robots.txt` disallows `/audits/`, `/admin/`, `/api/audit/`, and `/api/stripe/`.
- Private report and admin routes return `x-robots-tag: noindex, nofollow`.

## Operations QA

- `/admin/diagnostics` is available locally without a token only when `ADMIN_ACCESS_TOKEN` is unset. If it is configured, send the same value as the `x-admin-token` header.
- Diagnostics show blocked audits, provider errors, stale facts, reviewer rejections, LLM cost estimates, and job failures without rendering sample secrets or traveler emails.
- Observability events sanitize payloads before reporting sink configuration for Sentry and PostHog.
- Rate limits are applied to intake, checkout, public APIs, Stripe webhook/provider calls, and report access.

## Provider And Launch Limitations

- Real Stripe Checkout requires `STRIPE_RESTRICTED_KEY` or `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and a configured webhook endpoint.
- Real OpenAI generation requires `OPENAI_API_KEY`; `OPENAI_MODEL` and `OPENAI_REVIEWER_MODEL` default to `gpt-5.5` in code when unset.
- Background jobs are represented by local job primitives. A production worker backend must still be wired to the chosen Redis/Inngest/worker infrastructure.
- The first provider ingestion slice is local verified accommodation records from the public tourism directory source profile; it is permitted for public republication, does not store raw payloads, and emits governed accommodation-area facts only.
- Agoda, Tripadvisor/Terra, social, marketplace, and partner-source integrations remain approval-dependent and must not be scraped unless terms allow it.
- Public pages currently use synthetic or explicitly permitted fixture data for release-candidate QA.
