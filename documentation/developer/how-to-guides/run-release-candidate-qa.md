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
`TRIP_PASS_CHECKOUT_MODE=canary`, `TRIP_PASS_CHECKOUT_MODE=on`, or
`TRIP_PASS_EXTENSION_ENABLED=true` while blockers remain.

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

Run this sequence in a test-mode environment with `TRIP_PASS_CHECKOUT_MODE=off` until every
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
   path; verify one active 14-day pass with one `chat_message` meter limited to 150 answers.
6. Multi-tool consumption: run a paid answer that needs more than one support tool; verify one
   answer settles for the request and weather, Places, surf, and public-evidence checks do not spend
   separate customer allowances.
7. Failure release: force a provider failure before billable success; verify reservations release
   and the response labels unavailable or cached evidence truthfully.
8. Durable retry: disconnect after the answer is stored, then retry with the same idempotency key;
   verify the same stored response returns without another model call or Usage unit.
9. Expiry boundary: move the database fixture clock or use an expired fixture; verify the effective pass is
   no longer selected and UI/API warnings are coherent.
10. Refund or dispute: replay the verified test-mode refund or dispute fixture; verify access is
   revoked or suspended according to the launch policy without deleting ledger records.
11. Analytics delivery: confirm `trip_pass_checkout_started`, `trip_pass_activated`,
    `trip_pass_meter_warning` or `trip_pass_meter_exhausted`, and `llm_cost_recorded` reach the
    approved sink with sanitized fields only.
12. Reconciliation: run dry-run diagnostics and confirm paid order, pass, grant, usage meter,
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
| Price/currency | Live Stripe Price ID is USD 9.99; fees and tax treatment are approved. |
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

1. Set `TRIP_PASS_CHECKOUT_MODE=off` and redeploy.
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

## Protected Provider Lanes

Provider evidence is a manual post-merge release-candidate gate, never a pull-request or fork job.
In GitHub Actions, dispatch `Protected provider release candidate` from the default branch and enter
the exact 40-character commit SHA. Both jobs use the `provider-release-candidate` environment, so
the eligible non-author human approver must confirm that the SHA is the intended candidate and that
the dedicated Clerk test instance, protected-staging deployment, and Stripe test-mode account are
selected. The workflow rejects a SHA not already contained in `main`.

The protected environment owns the stable app and production origins, dedicated account fixture
identifiers, policy versions, retention durations, and the exact dedicated test-database host and
database name. `PROVIDER_RC_DATABASE_ENVIRONMENT` must be `protected-test`; both the configured
host and database name must contain an explicit test/staging/QA marker and must not contain a
production/live/main marker. Its secret inventory contains only the test
Clerk keys/identities and webhook signing secret, a least-privilege Stripe test restricted key,
Price, and webhook secret, the dedicated staging database credential, and the same Closure
Tombstone/provider-subject keys used by that staging deployment. Every secret is scoped to the one
provider-lane step after checkout, repository/event/environment, exact-HEAD, and `main` ancestry
checks pass. No secret is available to checkout or trust-proof steps. Do not copy these values into
repository variables, pull-request secrets, artifacts, or operator notes.

Before the first protected run, provision a staging-only
`provider_release_candidate_sentinel` table with one `id = 'provider-release-candidate'` row,
`environment = 'protected-test'`, and an unguessable fingerprint stored separately as the
`PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT` environment secret. Grant the protected QA database
role read access to that row and `schema_migrations`; do not add either grant to the production
runtime role. At the beginning of each lane, the preflight checks the URL host/name allow and deny
rules, sentinel fingerprint, and the complete ordered migration filename/checksum ledger against
the checked-out files. Missing, extra, reordered, or changed ledger rows stop the lane before any
fixture or provider mutation.

The Clerk lane uses Clerk's project-based Playwright setup (`clerkSetup`) and injects a testing token
per browser flow (`setupClerkTestingToken`). It covers email-code and a real configured Google OAuth
redirect, provider login, consent/callback, and verified external account; a ticket/email helper is
forbidden in the Google case. Provision a dedicated challenge-free Google test account because
CAPTCHA, interactive challenge, or 2FA fails the proof closed. It also covers session persistence
and single-session policy, sign-out, protected route/API denial,
cross-account ownership denial, step-up Account Closure, and local webhook convergence. The job
delivers Standard Webhooks/Svix-compatible signed lifecycle events through
`/api/clerk/webhooks`, checks dedicated-database convergence and deletion, drains the Closure
Operation through the normal worker, and confirms by an authoritative Clerk lookup that provider
deletion converged. Before provider acceptance, an authenticated protected-only probe verifies that
the staging origin is serving the requested Vercel commit SHA. The closure identity is disposable
and must be recreated by the eligible human before a subsequent run. Traces, screenshots, videos,
cookies, raw webhook bodies, identities, and provider payloads are not uploaded.

The workflow has one SHA-independent concurrency group with cancellation disabled, and the Stripe
job depends on Clerk. Different dispatches and provider lanes therefore cannot overlap or cancel a
worker halfway through shared protected-test state. Every third-party action is pinned to a reviewed
full commit SHA, and the workflow token has read-only repository contents permission.

The Stripe lane signs into disposable Clerk test users at the protected app origin, verifies the
origin's exact deployed SHA, and starts Checkout through the authenticated app endpoint. It covers
an ambiguous retry, return-before-event, authenticated expiry, hosted test-card payment, signed
delivery through `/api/stripe/webhook`, activation and duplicate delivery, paid-answer meter
settlement, cumulative refunds, reversed dispute delivery and retry, and Paid After Closure with a
durable refund obligation. Refund and dispute responses carry the in-process ordering probe proving
that authoritative Stripe retrieval completed before application began. Local lifecycle,
reconciliation, closure-refund, and usage contract tests remain supplemental; they do not replace
the protected app/provider flow. Signed event envelopes and the Stripe client both import the same
`STRIPE_API_VERSION` used by the production inbox; no harness API-version literal is allowed. The
worker then cleans up the disposable users, test-mode commerce
resources, and closure refund work. Raw webhook bodies and provider identifiers are never written to
evidence or logs.

The ambiguous retry proof uses a controlled HTTP client that lets Stripe accept a one-unit test-mode
refund and then drops the first response. The retry uses the identical idempotency key and asserts
one matching provider refund plus one app-visible cumulative refund effect before proceeding.

Each scenario appends its receipt only after its protected assertion completes. Evidence generation
requires the exact complete scenario set, so an omitted or failed scenario cannot be represented by
an unconditional list. Each passing lane writes a redacted artifact named for the exact SHA. The
artifact contains the migration filenames and checksums, the verified deployed-ledger fingerprint,
and a SHA/lane/migration fingerprint. Any code commit or
migration-content change therefore requires a new protected run; copying evidence from another SHA
does not satisfy the release gate. Protected credentials unavailable to an agent are an expected
administrative boundary: record the pending human environment approval/run instead of substituting
mock evidence or adding secrets to a normal CI job.
