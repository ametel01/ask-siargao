# Environment Reference

The app reads these environment variables.

| Variable | Surface | Required For | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public/client-safe | Checkout URLs and canonical public URLs | Defaults exist in some local code paths, but set this in deployed environments. |
| `CLERK_AUTH_MODE` | Server only | Clerk perimeter mode | Explicit enum: `enabled` or `disabled`. Production and `protected-staging` require `enabled`; untrusted previews must be `disabled` and must not receive Clerk keys. Enablement is never inferred from key presence. |
| `NEXT_PUBLIC_CLERK_AUTH_MODE` | Public/client-safe | Clerk UI mode | Explicit enum: `enabled` or `disabled`. Enabled deployments require this to match `CLERK_AUTH_MODE` so client Clerk UI cannot drift from the server perimeter. |
| `CLERK_DEPLOYMENT_CONTEXT` | Server only | Clerk deployment matrix | Optional explicit enum: `local`, `test`, `build`, `preview`, `production`, or `protected-staging`. When omitted, the app uses `NODE_ENV` and `VERCEL_ENV` only to choose the context, not to infer auth enablement. |
| `CLERK_AUTHORIZED_PARTIES` | Server only | Clerk middleware token-origin validation | Comma-separated exact URL origins passed to Clerk `authorizedParties`. Production and protected staging must exactly match `CLERK_PRODUCTION_ORIGIN` plus `CLERK_PROTECTED_STAGING_ORIGIN`; wildcard hosts, paths, credentials, query strings, fragments, and trailing slashes are rejected. |
| `CLERK_PRODUCTION_ORIGIN` | Server only | Protected Clerk deployments | Exact production HTTPS origin. Required in production and protected staging so `authorizedParties` can include the production origin without trusting preview wildcards. |
| `CLERK_PROTECTED_STAGING_ORIGIN` | Server only | Protected Clerk deployments | Exact stable protected-staging HTTPS origin. Required in production and protected staging. |
| `CLERK_PROTECTED_STAGING_GIT_COMMIT_REF` | Server only | Protected staging platform binding | Optional exact Git branch identity for protected staging. When set, `VERCEL_GIT_COMMIT_REF` must match. Use with or instead of `CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV`. |
| `CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV` | Server only | Protected staging platform binding | Optional exact Vercel target environment for protected staging. When set, `VERCEL_TARGET_ENV` must match. Vercel Custom Environments may report `VERCEL_ENV=production`; that production-class runtime is accepted for protected staging only when this exact non-production target matches. Use with or instead of `CLERK_PROTECTED_STAGING_GIT_COMMIT_REF`. |
| `CLERK_VERCEL_PROJECT_ID` | Server only | Protected Clerk deployments | Exact stable Vercel project ID. Production and protected staging require this to match the platform-provided `VERCEL_PROJECT_ID`; generated `VERCEL_URL` values are not trusted because they change on redeploy. Production also requires Vercel's exact-host `VERCEL_PROJECT_PRODUCTION_URL` signal, but that signal may be the shortest project domain (for example, the apex domain) while `CLERK_PRODUCTION_ORIGIN` deliberately uses another assigned canonical domain (for example, `www`). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public/client-safe | Clerk frontend SDK | Required only when `CLERK_AUTH_MODE=enabled`. |
| `CLERK_SECRET_KEY` | Server only | Clerk `auth()`, route protection, and backend API calls | Required only when `CLERK_AUTH_MODE=enabled`. Must not use the `NEXT_PUBLIC_` prefix. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Server only | Clerk webhook verification | Required only when `CLERK_AUTH_MODE=enabled`; `/api/clerk/webhooks` remains public at the proxy layer and verifies this signature in the handler. |
| `ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY` | Server only | Closure Tombstone matching | Required in production so Clerk IDs are matched to hashed closure tombstones without storing readable IDs. Local development uses a deterministic fallback. |
| `ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY_VERSION` | Server only | Closure Tombstone key rotation | Positive integer stored with closure hashes. Defaults to `1` locally; increment only under a privacy-reviewed rotation plan. |
| `ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON` | Server only | Closure Tombstone rotation grace | Optional JSON object mapping still-supported positive key versions to old HMAC secrets, for example `{\"1\":\"old-secret\"}`. Keep only privacy-approved grace versions; this keyring is never persisted or logged and prevents rotation from creating a second closure for the same immutable Clerk ID. |
| `ACCOUNT_CLOSURE_PROVIDER_SUBJECT_KEY` | Server only | Retry-owned Clerk deletion state | Required in production. Base64-encoded 32-byte AES-256-GCM key used only for the transient Clerk subject needed by retry workers. Never expose it as `NEXT_PUBLIC_*`. |
| `ACCOUNT_CLOSURE_PROVIDER_SUBJECT_KEY_VERSION` | Server only | Provider subject key rotation | Positive integer identifying the configured transient-subject key. Defaults to `1` locally. Retain an old key until every operation encrypted with it has completed. |
| `ACCOUNT_CLOSURE_POLICY_VERSION` | Server only | Terminal closure policy | Required in production and recorded on closure operations/tombstones so purge decisions remain attributable. |
| `ACCOUNT_CLOSURE_RETENTION_DAYS` | Server only | Closure Tombstone retention | Required positive day count in production. Local development defaults to `30`; purge still requires every closure step and refund obligation to be complete. |
| `ACCOUNT_CLOSURE_ALERT_AFTER_ATTEMPTS` | Server only | Closure worker alerting | Required positive attempt threshold in production. Local development defaults to `3`; reaching it alerts but does not dead-letter the retryable step. |
| `ACCOUNT_CLOSURE_WORKER_BATCH_SIZE` | Server only | Closure cleanup worker | Optional positive integer limiting attempts per invocation. Defaults to `100`. The human-selected scheduler should invoke the worker repeatedly until due work is drained. |
| `PAID_AFTER_CLOSURE_REFUND_BATCH_SIZE` | Server only | Paid After Closure refund worker | Optional positive integer limiting leased refund obligations per invocation. Defaults to `100`. |
| `PAID_AFTER_CLOSURE_REFUND_ALERT_AFTER_ATTEMPTS` | Server only | Paid After Closure refund paging | Optional positive attempt threshold. Defaults to `3`; reaching it records durable page state without stopping retries. |
| `COMMERCE_RETENTION_POLICY_VERSION` | Server only | Minimized commerce evidence | Required in production and stored on retained commerce evidence/refund obligations. |
| `COMMERCE_RETENTION_DAYS` | Server only | Minimized commerce retention | Required positive day count in production. Local development defaults to `365`; raw provider payloads and readable account identity are not retained as commerce evidence. |
| `PAID_ANSWER_DETAIL_RETENTION_DAYS` | Server only | Paid Answer Reservation detail expiry | Required positive day count in production. Local development defaults to `30`. After this database-time deadline, request hashes, provider request IDs, stored replay payloads, and answer links are purged while aggregate Usage Meter totals remain. |
| `PRIVACY_RESTORE_SNAPSHOT_VERSION` | Server only | Restore traffic guard | Required by `bun run privacy:restore-guard`; must match the privacy reapplication snapshot recorded after restore. |
| `PRIVACY_RESTORE_SOURCE_MAX_CLOSED_AT` | Server only | Restore traffic guard | Required ISO timestamp for the newest closure represented by the restored source. Traffic must remain disabled until the recorded reapplication watermark is at least this value. |
| `NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED` | Public/client-safe | Clerk SDK telemetry | Defaults to `1` in `next.config.ts`; set to `0` only when intentionally opting in to development telemetry. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Public/client-safe | Clerk sign-in routing | Set to `/sign-in` for the local prebuilt auth page. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Public/client-safe | Clerk post-sign-in redirects | Recommended default: `/chat`. |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Public/client-safe | Clerk post-sign-up redirects | Recommended default: `/chat`. |
| `PLAYWRIGHT_PROTECTED_UI_HARNESS` | Server only | Local E2E protected-page UI harness | Test-only. When set to `1` with explicit local/test disabled Clerk mode and a long `PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN`, Playwright can exercise protected page UI by sending both harness headers. Validation rejects this flag in production runtime or when any Vercel deployment signal is present. Never set in deployed environments. |
| `PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN` | Server only | Local E2E protected-page UI harness | Test-only token required by the harness request header `x-ask-siargao-protected-ui-harness-token`. Must be at least 32 characters and is ignored unless `PLAYWRIGHT_PROTECTED_UI_HARNESS=1`. |
| `PROVIDER_RC_EXPECTED_SHA` | Protected CI only | Provider release-candidate lanes | Full lowercase commit SHA selected by the human workflow dispatcher. It must equal the checked-out commit and already be contained in `main`. |
| `PROVIDER_RC_APP_ORIGIN` | Protected CI only | Provider release-candidate lanes | Dedicated protected-staging HTTPS origin. It must differ from `PROVIDER_RC_PRODUCTION_ORIGIN`; its authenticated staging-only probe must report the exact `VERCEL_GIT_COMMIT_SHA` requested by the workflow. |
| `PROVIDER_RC_PRODUCTION_ORIGIN` | Protected CI only | Provider release-candidate lane denial | Exact production origin used only to prove the protected test origin is not production. |
| `PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET` | Protected environment secret | Protected provider QA only | Dedicated Vercel Protection Bypass for Automation value passed as an HTTP header by the protected Playwright lanes. It must not be persisted in browser artifacts. |
| `PROVIDER_RC_BOUNDARY_USER` | Protected CI secret | Provider release-candidate lanes | Persistent dedicated `+clerk_test` account used only for the post-worker exact-SHA and database-boundary recheck. Keep it separate from disposable closure and commerce fixtures. |
| `PROVIDER_RC_CLERK_EMAIL_CODE_USER` | Protected CI secret | Clerk lane | Dedicated `+clerk_test` account for email-code, session, sign-out, route, and API checks. |
| `PROVIDER_RC_CLERK_GOOGLE_EMAIL` | Protected CI secret | Clerk lane | Dedicated non-production Google identity whose OAuth callback was completed interactively once. The protected lane proves the current Google redirect, requires exactly one verified Google external account for this email through Clerk's Backend API, and signs in that same Clerk subject with the official testing helper. No Google password is stored in CI. |
| `PROVIDER_RC_CLERK_CLOSURE_USER` | Protected CI secret | Clerk lane | Disposable dedicated `+clerk_test` account used only for terminal Account Closure and deletion convergence. A human must recreate it before a later run. |
| `PROVIDER_RC_FOREIGN_SAVED_ITEM_ID` | Protected CI secret | Clerk lane | Redacted fixture identifier owned by another dedicated test account; used to prove ownership denial without exposing its owner. |
| `PROVIDER_RC_STRIPE_ACTIVE_USER` | Protected CI secret | Stripe lane | Disposable `+clerk_test` user for Checkout activation, paid-answer settlement, and cumulative-refund convergence. |
| `PROVIDER_RC_STRIPE_REVERSED_USER` | Protected CI secret | Stripe lane | Disposable `+clerk_test` user for reversed dispute delivery and retry. |
| `PROVIDER_RC_STRIPE_CLOSURE_USER` | Protected CI secret | Stripe lane | Disposable `+clerk_test` user for the in-flight Checkout/Account Closure race and Paid After Closure refund. |
| `DATABASE_URL` | Server only | Production database client | Required by app database clients and Postgres-backed CLI/job scripts. In deployed app runtimes, use a credential mapped to the `ask_siargao_runtime` role from the database authorization reference. Test migration and seed commands use PGlite. |
| `PROVIDER_RC_DATABASE_ENVIRONMENT` | Protected environment variable | Protected provider QA only | Must equal `protected-test`; normal CI and production must not set it. |
| `PROVIDER_RC_DATABASE_EXPECTED_HOST` | Protected environment variable | Protected provider QA only | Exact dedicated staging/test database hostname parsed from the protected connection URL. Opaque managed-service hostnames are allowed only when the resource-name marker and sentinel also pass. |
| `PROVIDER_RC_DATABASE_EXPECTED_NAME` | Protected environment variable | Protected provider QA only | Exact database name parsed from the protected connection URL. Opaque managed-service defaults are allowed only when the resource-name marker and sentinel also pass. |
| `PROVIDER_RC_DATABASE_RESOURCE_NAME` | Protected environment variable | Protected provider QA only | Provider control-plane resource name proving the opaque managed PostgreSQL endpoint belongs to a staging, test, or provider-RC resource and not production. |
| `PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT` | Protected environment secret | Protected provider QA only | Unguessable value matching the staging-only sentinel row. It is step-scoped after trust proof and must never be logged or copied to artifacts. |
| `DATABASE_POOL_SIZE` | Server only | App/shared Postgres clients | Optional. Positive integer. Defaults to `2` in production and `10` outside production. |
| `DATABASE_CLI_POOL_SIZE` | Server only | CLI/job Postgres clients | Optional. Positive integer. Defaults to `1` so one-off scripts do not fan out database connections. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | Server only | Postgres clients | Optional. Positive integer seconds. Defaults to `10`. |
| `DATABASE_IDLE_TIMEOUT_SECONDS` | Server only | Postgres clients | Optional. Integer seconds greater than or equal to `0`; `0` disables idle closing. Defaults to `30`. |
| `DATABASE_MAX_LIFETIME_SECONDS` | Server only | Postgres clients | Optional. Integer seconds greater than or equal to `0`; `0` disables lifetime closing. Defaults to `1800`. |
| `DATABASE_SSL_MODE` | Server only | Postgres clients | Required to be `verify-full` when `NODE_ENV=production`. Outside production, allowed values are `disable`, `allow`, `prefer`, `require`, and `verify-full`, defaulting to `disable` for local Docker compatibility. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Server only | Postgres clients | Optional. Integer milliseconds greater than or equal to `0`; `0` disables and omits the connection-level startup parameter for PgBouncer compatibility. Defaults to `30000` for app clients in production, `120000` for CLI/job clients in production, and `0` outside production. |
| `STRIPE_RESTRICTED_KEY` | Server only | Stripe Checkout API calls | Preferred server key for Checkout permissions. |
| `STRIPE_SECRET_KEY` | Server only | Stripe Checkout API calls | Fallback when `STRIPE_RESTRICTED_KEY` is not set. |
| `STRIPE_WEBHOOK_SECRET` | Server only | Stripe webhook verification | Required by `/api/stripe/webhook`. |
| `STRIPE_TRIP_PASS_PRICE_ID` | Server only | Trip Pass Checkout | Required before `TRIP_PASS_CHECKOUT_MODE=canary` or `TRIP_PASS_CHECKOUT_MODE=on` can create Trip Pass Checkout sessions. This Price is the amount/currency authority for the Trip Pass. Do not expose it as `NEXT_PUBLIC_*`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public/client-safe | Client-side Stripe surfaces | Present in `.env.example`; current Checkout flow is server initiated. |
| `TRIP_PASS_CHECKOUT_MODE` | Server only | Trip Pass rollout | Optional enum: `off`, `canary`, or `on`. Defaults safely to `off`, including malformed values. `canary` and `on` require `STRIPE_TRIP_PASS_PRICE_ID`; otherwise the catalog reports checkout as unavailable. |
| `TRIP_PASS_CHECKOUT_CANARY_ACCOUNT_IDS` | Server only | Trip Pass rollout | Optional comma-separated immutable account/user IDs allowed to use checkout when `TRIP_PASS_CHECKOUT_MODE=canary`. Empty canary allowlists keep checkout unavailable. |
| `TRIP_PASS_ANON_HMAC_KEY` | Server only | Anonymous Trip Pass identity signing and HMAC cohorts | Required in production for anonymous reset resistance. Local development uses a fallback key for cookie behavior but does not enforce cohort reset-resistance unless this key is set. |
| `TRIP_PASS_ANON_HMAC_KEY_VERSION` | Server only | Anonymous Trip Pass identity key version | Optional positive integer. Defaults to `1`; increment during HMAC key rotation. |
| `TRIP_PASS_IPV6_COHORT_BITS` | Server only | Anonymous network cohorting | Optional positive integer. Defaults to `64`; controls IPv6 prefix grouping before HMAC. |
| `TRIP_PASS_WAF_MODE` | Server only | Perimeter WAF rollout mode | Optional enum: `disabled`, `log`, or `challenge`. See `documentation/developer/reference/vercel-waf-trip-pass.md` for Vercel WAF log-mode rules, promotion criteria, and rollback. |
| `CHAT_MODEL_PROVIDER` | Server only | Production chat provider selection | Optional enum: `deepseek` or `openai`; defaults to `deepseek`. Production startup requires the selected provider's API key. DeepSeek production additionally requires the versioned public acknowledgement gate and an explicit recorded privacy/legal decision. |
| `NEXT_PUBLIC_MODEL_PROVIDER_CONSENT_REQUIRED` | Public browser and server | Versioned model-provider acknowledgement gate | Must be exactly `true` in production when `CHAT_MODEL_PROVIDER=deepseek`. A same-origin endpoint records the current disclosure version in a bounded HttpOnly, same-site cookie before the UI submits, and the production API returns `428 model_provider_consent_required` when that cookie is absent or stale. This technical gate does not replace the required owner privacy/legal decision. |
| `DEEPSEEK_API_KEY` | Server only | DeepSeek Ask Siargao chat model | Required when `CHAT_MODEL_PROVIDER=deepseek`. The key alone does not authorize exposure; retain the public disclosure and owner privacy/legal evidence with the release. |
| `DEEPSEEK_BASE_URL` | Server only | DeepSeek OpenAI-compatible client | Optional. Defaults to `https://api.deepseek.com`. |
| `DEEPSEEK_MODEL` | Server only | Primary Ask Siargao chat model override | Optional. Defaults to `deepseek-v4-flash`, DeepSeek's basic/lower-cost current model. |
| `DEEPSEEK_COST_POLICY_ENABLED` | Server only | DeepSeek cost-policy rollback switch | Optional boolean. Defaults to `true`, using non-thinking calls for free and routine turns after the fixed cost/quality corpus passed. Free turns retain bounded repair-loop headroom so required evidence ordering and artifact filtering can complete. Set to `false` only to roll back to the high-thinking baseline policy. |
| `DEEPSEEK_DAILY_USD_LIMIT` | Server only | DeepSeek cost circuit | Optional non-negative number for provider-level daily budget checks. |
| `MODEL_COST_RESERVATION_MICRO_USD` | Server only | Model cost circuit reservation size | Optional positive integer reservation in micro-USD per model call. Defaults to `2000` outside production and a conservative USD 1 (`1000000`) in production. Production startup rejects a lower explicit value. Reservations reconcile to modeled usage after each call. |
| `OPENAI_API_KEY` | Server only | OpenAI primary/fallback and OpenAI Responses API services | Required when `CHAT_MODEL_PROVIDER=openai`, and for chat fallback, real report generation, reviewer calls, hosted web search, hosted agent-memory file search, and `bun run agent-memory:sync` when those separately gated features are used. |
| `OPENAI_MODEL` | Server only | OpenAI chat and audit generator model override | Defaults to `gpt-5.4-mini`. Chat uses it as the primary model when `CHAT_MODEL_PROVIDER=openai`, or as the fallback model when fallback is separately enabled. |
| `OPENAI_REVIEWER_MODEL` | Server only | Reviewer model override | Defaults to `gpt-5.4-mini`. |
| `OPENAI_FALLBACK_ENABLED` | Server only | Paid Trip Pass fallback policy | Optional boolean. Defaults to `false`; free traffic must not silently fall back to OpenAI. |
| `OPENAI_FALLBACK_DAILY_USD_LIMIT` | Server only | Paid fallback cost circuit | Optional non-negative number for paid fallback budget checks. |
| `OPENAI_DAILY_USD_LIMIT` | Server only | OpenAI provider cost circuit | Optional non-negative number for provider-level daily budget checks. |
| `GLOBAL_MODEL_DAILY_USD_LIMIT` | Server only | Global model cost circuit | Optional non-negative number. Production always enforces at most USD 10 per UTC day even when this is missing or higher. |
| `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` | Server only | Chat agent file-search memory | Optional vector store ID containing synced `docs/agent-memory/` reference files. Set this from `bun run agent-memory:sync` output in deployed environments. Do not prefix it with `NEXT_PUBLIC_`. |
| `WEB_RESEARCH_PROVIDER` | Server only | Public web research for current chat prompts | Optional. Set to `openai` only with `WEB_RESEARCH_SECURITY_BOUNDARY_COMPLETE=true`, an approved OpenAI vendor boundary, and a configured cost cap. When unset, `research_web` returns explicit `provider_unavailable` evidence instead of using memory, weather, or Places as a fallback. |
| `WEB_RESEARCH_SECURITY_BOUNDARY_COMPLETE` | Server only | Web-research security gate | Must be exactly `true` as a second, explicit gate before web research can run. The implemented boundary treats hosted-search page content as untrusted during extraction, accepts only bounded HTTP(S) source fields, and encloses all downstream web evidence in a model-facing `untrusted_external_data` envelope covered by adversarial regression tests. |
| `OPENAI_WEB_SEARCH_MODEL` | Server only | OpenAI hosted web-search extraction model | Optional model override for the web research adapter. Defaults to `gpt-5.4-mini`. Requires `WEB_RESEARCH_PROVIDER=openai` and `OPENAI_API_KEY`. |
| `OPEN_METEO_API_MODE` | Server only | Local/preview Open-Meteo weather and marine adapters | Optional enum: `off` or `noncommercial`. Defaults to `noncommercial` outside production and `off` in production. Production weather uses credential-free MET Norway Locationforecast instead; production startup continues to reject the noncommercial Open-Meteo adapter. |
| `TIDE_FORECAST_MODE` | Server only | Local/preview Tide-Forecast Dapa adapter | Optional enum: `off` or `development`. Defaults to `development` outside production and `off` in production. Production tide checks use the public-domain NOAA/PacIOOS Pacific tide model instead; production startup continues to reject the unlicensed Tide-Forecast adapter. |
| `GOOGLE_API_KEY` | Server only | Google Places adapters, discovery, and enrichment | Required for live Google Places provider calls and by `bun run db:discover:google-places` and `bun run db:enrich:google-places`. Keep field masks narrow; chat lookup uses Google Places Text Search Enterprise fields for rating signals, opening hours, price, website, phone, and map links, but still excludes review text, bookings, and availability; discovery uses ID-only fields, enrichment uses Place Details Pro fields. Google retention pruning uses `DATABASE_URL` and does not require this key. |
| `GOOGLE_PLACES_DAILY_USD_LIMIT` | Server only | Google Places cost circuit | Optional non-negative number. Production always enforces at most USD 15 per UTC day even when this is missing or higher. |
| `GOOGLE_PLACES_SEARCH_RESERVATION_MICRO_USD` | Server only | Google Places SKU reservation | Optional positive micro-USD reservation per Text Search. Defaults to `35000` for the Enterprise field mask. |
| `REDIS_URL` | Server only | Shared quota infrastructure | Enables the bundled Redis quota store for production rate limits, exposure limits, anonymous free allowance, request idempotency, and cost circuits. Production requires `rediss://` and fails closed when shared control state is unavailable. |
| `CRON_SECRET` | Server only | Vercel Cron authentication | Required bearer secret for every `/api/cron/*` adapter. Vercel supplies it as `Authorization: Bearer …`. |
| `TRAVEL_ANSWER_EXPOSURE_MODE` | Server only | Emergency Travel Answer exposure control | Production accepts new Travel Answers continuously only when exactly `open`; missing, malformed, legacy `staffed`, or `off` closes exposure. The shared 1,000-answer UTC-day cap remains enforced. Set `off` for emergency shutdown. |
| `INTEGRATION_TEST_NAMESPACE` | Local/CI test only | Real PostgreSQL and Redis integration lanes | Optional lowercase namespace for `bun run test:integration:postgres` and `bun run test:integration:redis`. Defaults to `ask_siargao_issue150_local`; CI sets a run-specific value. Harnesses add UUID-suffixed database names and Redis prefixes under this namespace. |
| `INTEGRATION_TEST_ALLOW_REMOTE` | Local/CI test only | Real PostgreSQL and Redis integration lanes | Optional escape hatch. Set to `1` only for an explicitly disposable remote test service whose URL visibly contains a test marker such as `test`, `integration`, `issue`, `local`, or `ci`; Redis `/0` alone is not sufficient. Otherwise integration harnesses require localhost service URLs and refuse production-looking targets. |
| `TRUST_PROXY_HEADERS` | Server only | Rate-limit request identity | Defaults to `false`. Set to `true` only when a trusted edge/proxy owns `x-forwarded-for` or `x-real-ip`; otherwise requests share the local fallback identity. |
| `TRIP_PASS_IDEMPOTENCY_HMAC_KEY` | Server only | Request idempotency token hashing | Required in production for privacy-safe request idempotency tokens. Local development uses a fallback key. |
| `OPERATOR_ACCOUNT_IDS` | Server only | Operator authorization | Required comma-separated immutable Clerk Account IDs. Production diagnostics require membership. Every Repair Action additionally requires Clerk second-factor verification no older than five minutes. Never use email addresses or a public-prefixed variable. |
| `ADMIN_ACCESS_TOKEN` | Server only | Local read-only diagnostics compatibility | Accepted only outside production. It cannot authorize a Repair Action, goodwill grant, manual commerce transition, or account recovery. |
| `REPORT_ACCESS_TOKEN_SECRET` | Server only | Paid audit report access links | Optional signing secret used by the as-built audit report-access adapter to create and verify expiring HMAC access tokens. Keep the placeholder empty until that legacy paid-report surface is explicitly configured; never expose the value through `NEXT_PUBLIC_*`, logs, URLs, or evidence artifacts. It does not authorize Trip Pass access or Operator repair. |
| `SENTRY_DSN` | Server only | Operational delivery and paging | Enables deny-by-default scrubbed Sentry warnings/pages. High-impact alert keys are durably delivered once; the DSN is never rendered or logged. |
| `SENTRY_CRON_MONITOR_SLUG` | Server only | Quota-efficient Cron monitoring | Optional outside production; defaults to `ask-siargao-account-closure`. Set the same slug in staging and production so `/api/cron/operations` emits the single aggregate check-in allowed by the Sentry Developer plan. Places pruning remains independently tracked in `operational_schedule_states`. Weather and marine schedules are excluded while `OPEN_METEO_API_MODE=off`, and their routes return an explicit no-op if invoked. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Public/client-safe | PostHog sink configuration | Enables the timeout-bounded PostHog-compatible analytics sink for allowlisted server events. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Public/client-safe | PostHog host | Defaults in `.env.example` to the US PostHog ingest host. |

Server-only secrets must not use the `NEXT_PUBLIC_` prefix. `getServerSecret` rejects public-prefixed names so sensitive provider keys do not move into client-facing bundles.

Stripe clients and webhook normalization pin Stripe API version `2026-07-29.dahlia` and local
normalized event schema version `2` in code. These are not runtime environment switches. Version 2
preserves Stripe's signed event creation timestamp for deterministic closure ordering. A Stripe
webhook delivered with another API version is durably recorded as blocked after signature
verification rather than guessed from an unsupported shape.

Clerk instance settings are part of the deployment contract and are encoded in
`src/server/auth/clerk-instance-policy.ts`: verified email is required, sign-in methods are email
code and Google OAuth only, maximum session age is seven days, Operator MFA is required, and
multiple simultaneous sessions are disabled.

Chat model calls use a 15-second per-attempt deadline with one retry before fallback. Hosted web
research uses a 25-second per-attempt deadline with one retry. Live weather, marine, tide, and
Google Places HTTP calls use a 15-second deadline so a stalled provider returns a caveated result
instead of holding the chat request indefinitely. Production MET Norway responses are cached for
30 minutes. Deterministic NOAA/PacIOOS tide-model queries are cached for one day.

## Database Credentials

Production should use separate database credentials for runtime and migration work:

- deployed app runtimes use `DATABASE_URL` with an `ask_siargao_runtime` login;
- migration jobs run `bun run db:migrate` with a migration-only credential mapped to
  `ask_siargao_migration`;
- optional read/reporting tools use separate read-only credentials mapped to
  `ask_siargao_reporting`.

See [Database authorization reference](database-authorization.md) for the role and grant template.

## Production Rate-Limit Storage

Production rate limiting fails closed when the active `RateLimitStore` has `scope: "process"`.
Development and test can use the default process-local memory store. Production should set
`REDIS_URL` so the bundled Redis quota store provides atomic increments, rolling-window
reservations, concurrency leases, idempotency records, and budget reservations across all runtime
instances. There is no environment override for process-local production rate limits.

## Trip Pass Launch Ownership

Production checkout must remain disabled until the release owner records the final approval state in
the release-candidate QA run. Code completion is not launch approval.

| Area | Owner | Required action before `TRIP_PASS_CHECKOUT_MODE=canary` or `on` |
| --- | --- | --- |
| Stripe Price | Finance/operator | Confirm live Price ID, amount, currency, fees, tax treatment, and Stripe-account eligibility. |
| Stripe webhook | Engineering | Confirm endpoint URL, signing secret, and subscribed Checkout, refund, dispute, and expiry events. |
| Legal/refund policy | Legal/operator | Approve Trip Pass Terms, Privacy wording, full-refund revocation, dispute suspension, and support contact copy. |
| Redis | Engineering | Confirm provider, TLS, eviction policy, retention expectations, and operational owner. |
| Analytics | Operator | Confirm PostHog-compatible host, key, retention, consent wording, and DNT behavior. |
| DeepSeek cost policy | Operator | Confirm price catalog version, `DEEPSEEK_COST_POLICY_ENABLED`, and daily provider budget. |
| Paid fallback | Operator | Confirm whether `OPENAI_FALLBACK_ENABLED` is allowed, plus the daily fallback budget. |
| WAF | Security/operator | Run Vercel WAF in log mode first and record evidence before challenge promotion. |
| Identity keys | Security | Record `ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY`, `TRIP_PASS_ANON_HMAC_KEY`, and `TRIP_PASS_IDEMPOTENCY_HMAC_KEY` owners, rotation date, and rollback plan. |
| Monitoring | Operator | Confirm alerts for checkout failures, webhook failures, cost-circuit exhaustion, analytics sink failures, and reconciliation issues. |
| Review | Operator | Record non-author release review before checkout enablement. |

## Trip Pass Key Rotation

Rotate anonymous and idempotency HMAC keys deliberately:

1. Generate new server-only key material and store it outside the client environment.
2. Increment `TRIP_PASS_ANON_HMAC_KEY_VERSION` when rotating anonymous cohort keys.
3. Deploy with the new key and version while monitoring reset-resistance and challenge rates.
4. Keep the prior key available only for the planned grace window if the implementation requires
   compatibility, then remove it from the secret store.
5. Record the rotation date, owner, prior version, new version, and rollback decision in the release
   notes or incident log.

Do not rotate by changing a `NEXT_PUBLIC_*` variable, and do not store raw IP addresses, cookie
values, Clerk IDs, prompts, or precise coordinates as a replacement for HMAC cohorts.

## Trip Pass Alert Thresholds

Operators should alert on:

- Stripe webhook verification or application failures above zero after deployment.
- Blocked or retrying rows in `trip_pass_stripe_events`, especially unsupported API versions,
  immutable duplicate fact mismatches, and rows whose alert state reaches `watch` or `page`.
- Checkout start failures, duplicate-order conflicts, or pending orders that do not receive a
  terminal webhook.
- Trip Pass meter warning/exhaustion spikes by meter type.
- Redis quota-store unavailability, stale reservations, or production process-local fallback.
- DeepSeek, OpenAI fallback, or global model-cost budget exhaustion.
- Analytics sink delivery failures or unexpected absence of `trip_pass_checkout_started`,
  `trip_pass_activated`, and `llm_cost_recorded` events.
- Confirmed paid-without-pass, money/access mismatch, immediate closure-phase failure, Paid After
  Closure refund failure, verified Stripe persistence/repeated-application failure, and Redis
  outage while checkout is `canary`/`on` page once through Sentry. Lower-impact findings remain
  warnings or tickets. PostHog is analytics-only and never owns operational delivery.

Support escalation starts with `/admin/diagnostics` and the dry-run reconciliation snapshot. Do not
ask support staff to inspect raw prompts, email addresses, Stripe payloads, precise locations,
cookies, provider payloads, or upstream request IDs.

## Trip Pass Rollback

Rollback is flag-based and forward-repair only:

1. Set `TRIP_PASS_CHECKOUT_MODE=off` and redeploy.
2. Set `OPENAI_FALLBACK_ENABLED=false` if fallback cost or quality behavior is suspect.
3. Set `TRIP_PASS_WAF_MODE=log` or disable promoted WAF rules if legitimate shared-network traffic
   is challenged incorrectly.
4. Run read-only reconciliation, then use a separate Repair Action only with an opaque Finding ID,
   an allowlisted named Operator, fresh Clerk MFA, a before/after preview, explicit confirmation,
   a reason code, and an idempotency key.
5. Preserve order, pass, grant, meter, usage-event, Stripe inbox, analytics, and cost records. Do
   not drop launch data to roll back.

Database rollback uses backups and forward repair. Before enabling checkout, confirm production
backup restore has been tested for the database provider and that migration credentials are separate
from runtime credentials.
