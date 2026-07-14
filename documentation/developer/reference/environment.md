# Environment Reference

The app reads these environment variables.

| Variable | Surface | Required For | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public/client-safe | Checkout URLs and canonical public URLs | Defaults exist in some local code paths, but set this in deployed environments. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public/client-safe | Clerk frontend SDK | Required by `ClerkProvider`, `SignIn`, `SignUp`, and chat auth UI. |
| `CLERK_SECRET_KEY` | Server only | Clerk `auth()`, route protection, and backend API calls | Must not use the `NEXT_PUBLIC_` prefix. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Server only | Clerk webhook verification | Required by `/api/clerk/webhooks`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Public/client-safe | Clerk sign-in routing | Set to `/sign-in` for the local prebuilt auth page. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Public/client-safe | Clerk post-sign-in redirects | Recommended default: `/chat`. |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Public/client-safe | Clerk post-sign-up redirects | Recommended default: `/chat`. |
| `DATABASE_URL` | Server only | Production database client | Required by app database clients and Postgres-backed CLI/job scripts. In deployed app runtimes, use a credential mapped to the `ask_siargao_runtime` role from the database authorization reference. Test migration and seed commands use PGlite. |
| `DATABASE_POOL_SIZE` | Server only | App/shared Postgres clients | Optional. Positive integer. Defaults to `10` for long-lived app clients. |
| `DATABASE_CLI_POOL_SIZE` | Server only | CLI/job Postgres clients | Optional. Positive integer. Defaults to `1` so one-off scripts do not fan out database connections. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | Server only | Postgres clients | Optional. Positive integer seconds. Defaults to `10`. |
| `DATABASE_IDLE_TIMEOUT_SECONDS` | Server only | Postgres clients | Optional. Integer seconds greater than or equal to `0`; `0` disables idle closing. Defaults to `30`. |
| `DATABASE_MAX_LIFETIME_SECONDS` | Server only | Postgres clients | Optional. Integer seconds greater than or equal to `0`; `0` disables lifetime closing. Defaults to `1800`. |
| `DATABASE_SSL_MODE` | Server only | Postgres clients | Optional. Allowed values: `disable`, `allow`, `prefer`, `require`, `verify-full`. Defaults to `require` when `NODE_ENV=production`; otherwise defaults to `disable` for local Docker compatibility. `.env.example` sets `disable` for local Postgres. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Server only | Postgres clients | Optional. Integer milliseconds greater than or equal to `0`; `0` disables the connection-level statement timeout. Defaults to `30000` for app clients in production, `120000` for CLI/job clients in production, and `0` outside production. |
| `STRIPE_RESTRICTED_KEY` | Server only | Stripe Checkout API calls | Preferred server key for Checkout permissions. |
| `STRIPE_SECRET_KEY` | Server only | Stripe Checkout API calls | Fallback when `STRIPE_RESTRICTED_KEY` is not set. |
| `STRIPE_WEBHOOK_SECRET` | Server only | Stripe webhook verification | Required by `/api/stripe/webhook`. |
| `STRIPE_TRIP_PASS_PRICE_ID` | Server only | Trip Pass Checkout | Required before `TRIP_PASS_CHECKOUT_ENABLED=true` can create Trip Pass Checkout sessions. This Price is the amount/currency authority for the Trip Pass. Do not expose it as `NEXT_PUBLIC_*`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public/client-safe | Client-side Stripe surfaces | Present in `.env.example`; current Checkout flow is server initiated. |
| `TRIP_PASS_CHECKOUT_ENABLED` | Server only | Trip Pass rollout | Optional boolean. Defaults to `false`; when `true` without `STRIPE_TRIP_PASS_PRICE_ID`, the Trip Pass catalog reports checkout as unavailable instead of enabled. |
| `TRIP_PASS_EXTENSION_ENABLED` | Server only | Future Trip Pass extensions | Optional boolean. Defaults to `false`; extensions remain unavailable until launch approval. |
| `TRIP_PASS_ANON_HMAC_KEY` | Server only | Anonymous Trip Pass/free-tier identity | Server-side HMAC key for privacy-safe anonymous quota cohorts. Required before anonymous launch limits can be production-ready. |
| `TRIP_PASS_ANON_HMAC_KEY_VERSION` | Server only | Anonymous identity key rotation | Optional positive integer. Defaults to `1`. |
| `TRIP_PASS_WAF_MODE` | Server only | Trip Pass perimeter rollout | Optional. Allowed values: `disabled`, `log`, or `challenge`. Defaults to `disabled`. |
| `DEEPSEEK_API_KEY` | Server only | Primary Ask Siargao chat model | Required for DeepSeek primary chat generation. When unset, chat can still run with `OPENAI_API_KEY` as the fallback provider. |
| `DEEPSEEK_BASE_URL` | Server only | DeepSeek OpenAI-compatible client | Optional. Defaults to `https://api.deepseek.com`. |
| `DEEPSEEK_MODEL` | Server only | Primary Ask Siargao chat model override | Optional. Defaults to `deepseek-v4-flash`, DeepSeek's basic/lower-cost current model. |
| `DEEPSEEK_COST_POLICY_ENABLED` | Server only | DeepSeek cost-policy rollout | Optional boolean. Defaults to `false`; candidate mode must pass the fixed cost/quality corpus before promotion. |
| `DEEPSEEK_DAILY_USD_LIMIT` | Server only | DeepSeek cost circuit | Optional non-negative number for provider-level daily budget checks. |
| `OPENAI_API_KEY` | Server only | OpenAI fallback and OpenAI Responses API services | Required for chat fallback, real report generation, reviewer calls, hosted web search, hosted agent-memory file search, and `bun run agent-memory:sync` when not using `--dry-run`. |
| `OPENAI_MODEL` | Server only | OpenAI fallback and audit generator model override | Defaults to `gpt-5.4-mini`. Chat uses this only when DeepSeek is unavailable or not configured; audit generation still uses OpenAI Responses. |
| `OPENAI_REVIEWER_MODEL` | Server only | Reviewer model override | Defaults to `gpt-5.4-mini`. |
| `OPENAI_FALLBACK_ENABLED` | Server only | Paid Trip Pass fallback policy | Optional boolean. Defaults to `false`; free traffic must not silently fall back to OpenAI. |
| `OPENAI_FALLBACK_DAILY_USD_LIMIT` | Server only | Paid fallback cost circuit | Optional non-negative number for paid fallback budget checks. |
| `OPENAI_DAILY_USD_LIMIT` | Server only | OpenAI provider cost circuit | Optional non-negative number for provider-level daily budget checks. |
| `GLOBAL_MODEL_DAILY_USD_LIMIT` | Server only | Global model cost circuit | Optional non-negative number for global model budget checks. |
| `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` | Server only | Chat agent file-search memory | Optional vector store ID containing synced `docs/agent-memory/` reference files. Set this from `bun run agent-memory:sync` output in deployed environments. Do not prefix it with `NEXT_PUBLIC_`. |
| `WEB_RESEARCH_PROVIDER` | Server only | Public web research for current chat prompts | Optional. Set to `openai` to enable the `research_web` tool's OpenAI hosted web-search adapter. When unset, `research_web` returns explicit `provider_unavailable` evidence instead of using memory, weather, or Places as a fallback. |
| `OPENAI_WEB_SEARCH_MODEL` | Server only | OpenAI hosted web-search extraction model | Optional model override for the web research adapter. Defaults to `gpt-5.4-mini`. Requires `WEB_RESEARCH_PROVIDER=openai` and `OPENAI_API_KEY`. |
| `GOOGLE_API_KEY` | Server only | Google Places adapters, discovery, and enrichment | Required for live Google Places provider calls and by `bun run db:discover:google-places` and `bun run db:enrich:google-places`. Keep field masks narrow; chat lookup uses Google Places Text Search Enterprise fields for rating signals, opening hours, price, website, phone, and map links, but still excludes review text, bookings, and availability; discovery uses ID-only fields, enrichment uses Place Details Pro fields. Google retention pruning uses `DATABASE_URL` and does not require this key. |
| `INNGEST_EVENT_KEY` | Server only | Future job worker integration | Placeholder until the production worker backend is wired. |
| `INNGEST_SIGNING_KEY` | Server only | Future job worker integration | Placeholder until the production worker backend is wired. |
| `REDIS_URL` | Server only | Future worker/rate-limit infrastructure | Production rate limiting must be backed by an injected shared `RateLimitStore` configured through `configureRateLimitStore`; no Redis adapter is bundled yet. |
| `TRUST_PROXY_HEADERS` | Server only | Rate-limit request identity | Defaults to `false`. Set to `true` only when a trusted edge/proxy owns `x-forwarded-for` or `x-real-ip`; otherwise requests share the local fallback identity. |
| `ADMIN_ACCESS_TOKEN` | Server only | Production admin diagnostics access | Send the same value in the `x-admin-token` request header. |
| `SENTRY_DSN` | Server only | Observability sink configuration | Current event helper records whether it is configured. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Public/client-safe | PostHog sink configuration | Current event helper records whether it is configured. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Public/client-safe | PostHog host | Defaults in `.env.example` to the US PostHog ingest host. |

Server-only secrets must not use the `NEXT_PUBLIC_` prefix. `getServerSecret` rejects public-prefixed names so sensitive provider keys do not move into client-facing bundles.

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
Development and test can use the default process-local memory store, but production must inject a
shared, atomic store with `scope: "shared"` by calling `configureRateLimitStore` before handling
rate-limited requests.

No Redis, Upstash, or Vercel KV adapter is bundled yet. When one is added, it must preserve atomic
increment and expiry semantics across all production instances. There is no environment override for
process-local production rate limits.
