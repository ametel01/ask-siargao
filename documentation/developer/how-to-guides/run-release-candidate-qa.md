# Run Release-Candidate QA

Use this checklist before treating the current build as a release candidate.

## Automated Gates

Run the full gate suite from a clean working tree or after reviewing intentional local changes.

```sh
bun run format
git diff --check
bun run lint
bun run typecheck --incremental false
bun test
bun run db:migrate:test
bun run db:seed:test
bun run build
bun run test:e2e
bun run verify:ci
```

`bun run verify:ci` mirrors the CI release gate: lint, clean typecheck, Bun tests, test database migrate/seed, build, and Playwright e2e. `bun run verify` runs the fast non-mutating local subset. Use `bun run format` only when you want Biome to write formatting fixes. React Doctor runs in a separate advisory GitHub workflow and is available locally with `bun run doctor`.

For Trip Pass release candidates, also run the fixed cost, quality, bypass, and launch-proof
artifacts:

```sh
bun run eval:trip-pass-cost-baseline
bun run eval:trip-pass-cost-candidate
bun run eval:trip-pass-quality-bypass
bun run qa:trip-pass-launch -- --write
```

The launch-proof artifact is written to
`docs/evaluations/trip-pass-launch-proof-2026-07-14.json`. It is allowed to show
`launchReady: false` while external approvals or smoke checks are unresolved. It must not show
`TRIP_PASS_CHECKOUT_ENABLED=true` or `TRIP_PASS_EXTENSION_ENABLED=true` while blockers remain.

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

## Trip Pass End-to-End QA

Run this sequence in a test-mode environment with `TRIP_PASS_CHECKOUT_ENABLED=false` until every
approval and smoke check is recorded. Use redacted identifiers such as `cs_test_...abcd` or
`evt_test_...abcd` in notes; never paste full Stripe IDs, webhook payloads, cookies, prompts, IP
addresses, emails, precise coordinates, or provider responses.

1. Anonymous free allowance: ask enough successful chat questions to reach warning and exhausted
   states; verify the UI, `/api/chat` response shape, quota store, and analytics events.
2. Sign-in transition: sign in after anonymous usage and confirm the free context is bounded by the
   signed-in actor rather than reset to a new unrestricted allowance.
3. Checkout start: start a Trip Pass checkout from settings or chat; verify duplicate clicks do not
   create duplicate effective local orders.
4. Delayed return: visit the checkout return URL before webhook delivery; verify the UI remains
   pending and no pass is activated.
5. Verified activation: deliver the test-mode Stripe checkout completion through the signed webhook
   path; verify one active 14-day pass, 150 chat, 40 live, 8 heavy, 20 weather, and 25 route meters.
6. Multi-tool consumption: run a current/live paid answer that uses more than one support tool;
   verify chat and applicable live sub-meters settle once for the request.
7. Failure release: force a provider failure before billable success; verify reservations release
   and the response labels unavailable or cached evidence truthfully.
8. Expiry boundary: move the fixture clock or use an expired fixture; verify the effective pass is
   no longer selected and UI/API warnings are coherent.
9. Refund or dispute: replay the verified test-mode refund or dispute fixture; verify access is
   revoked or suspended according to the launch policy without deleting ledger records.
10. Analytics delivery: confirm `trip_pass_checkout_started`, `trip_pass_activated`,
    `trip_pass_meter_warning` or `trip_pass_meter_exhausted`, and `llm_cost_recorded` reach the
    approved sink with sanitized fields only.
11. Reconciliation: run dry-run diagnostics and confirm paid order, pass, grant, usage meter,
    provider request, price catalog, sink, store, and cost-circuit checks are visible and redacted.

Then run the adversarial controls:

- Clear the anonymous trip cookie from the same network cohort and verify challenge or sign-in
  friction instead of a full reset.
- Simulate shared hotel/carrier-network velocity and verify challenge rather than silent blanket
  denial of legitimate users.
- Replay one request ID with a different body and verify denial before model/provider work.
- Send parallel final-unit requests and verify only one request consumes the final allowance.
- Abort the client after model/provider success and verify the server settles the successful work
  once.
- Disable DeepSeek for free traffic and verify OpenAI fallback is not used.
- Exhaust the paid fallback budget and the global model budget and verify safe unavailable or
  cached/local responses.

## Trip Pass Production Approval Checklist

Checkout can be enabled only after all items below are approved and the launch-proof artifact is
updated with redacted evidence.

| Item | Required evidence |
| --- | --- |
| Price/currency | Approved live Stripe Price ID, amount, currency, fees, and tax treatment. |
| Legal/refund policy | Approved Trip Pass Terms, Privacy, support, full-refund, partial-refund, and dispute handling. |
| Redis | Provider URL configured, TLS/retention/eviction documented, and integration smoke passed. |
| Analytics | Sink host/key/retention/consent approved and sanitized smoke events observed. |
| Stripe account | Account eligibility, settlement currency, fees, and restricted-key permissions confirmed. |
| Webhook | Production endpoint, signing secret, subscribed events, and retry handling confirmed. |
| DeepSeek price version | Launch price catalog version and cost policy approved. |
| Paid fallback budget | OpenAI fallback policy, daily budget, and alert owner approved. |
| WAF log evidence | Vercel WAF rule IDs, log-mode sample counts, and challenge promotion decision recorded. |
| HMAC rotation | Anonymous and idempotency key owner, version, rotation date, and rollback handling recorded. |
| Provider/global budgets | DeepSeek, OpenAI, and global daily budget limits configured with alerts. |
| Secrets and monitoring | Secret inventory, alert thresholds, backup/restore proof, and non-author release review complete. |

## Trip Pass Rollback And Recovery

Rollback does not require destructive data changes:

1. Set `TRIP_PASS_CHECKOUT_ENABLED=false` and redeploy.
2. Keep `TRIP_PASS_EXTENSION_ENABLED=false`.
3. Disable paid fallback with `OPENAI_FALLBACK_ENABLED=false` if provider cost or quality is
   suspect.
4. Move WAF challenge rules back to log mode if shared-network traffic is affected.
5. Run Trip Pass reconciliation in dry-run mode and escalate findings with redacted local order or
   pass references.
6. Repair only idempotent local omissions after explicit operator confirmation; preserve Stripe,
   order, grant, pass, meter, usage-event, analytics, and cost records.

## Provider And Launch Limitations

- Real Stripe Checkout requires `STRIPE_RESTRICTED_KEY` or `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and a configured webhook endpoint.
- Real chat generation uses DeepSeek first when `DEEPSEEK_API_KEY` is set; `DEEPSEEK_MODEL`
  defaults to `deepseek-v4-flash`. `OPENAI_API_KEY` remains required for OpenAI fallback,
  report/reviewer generation, and hosted OpenAI services; `OPENAI_MODEL` and
  `OPENAI_REVIEWER_MODEL` default to `gpt-5.4-mini` in code when unset.
- Background jobs are represented by local job primitives. A production worker backend must still be wired to the chosen Redis/Inngest/worker infrastructure.
- The first provider ingestion slice is local verified accommodation records from the public tourism directory source profile; it is permitted for public republication, does not store raw payloads, and emits governed accommodation-area facts only.
- Agoda, Tripadvisor/Terra, social, marketplace, and partner-source integrations remain approval-dependent and must not be scraped unless terms allow it.
- Public pages currently use synthetic or explicitly permitted fixture data for release-candidate QA.
- Trip Pass production checkout remains approval-dependent even when the local deterministic proof
  passes. Missing sandbox/live evidence must be recorded as a release blocker, not as launch
  readiness.
