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
| `DATABASE_URL` | Server only | Production database client | Required by `createDatabaseClient`. Test migration and seed commands use PGlite. |
| `STRIPE_RESTRICTED_KEY` | Server only | Stripe Checkout API calls | Preferred server key for Checkout permissions. |
| `STRIPE_SECRET_KEY` | Server only | Stripe Checkout API calls | Fallback when `STRIPE_RESTRICTED_KEY` is not set. |
| `STRIPE_WEBHOOK_SECRET` | Server only | Stripe webhook verification | Required by `/api/stripe/webhook`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public/client-safe | Client-side Stripe surfaces | Present in `.env.example`; current Checkout flow is server initiated. |
| `OPENAI_API_KEY` | Server only | OpenAI Responses API client and agent-memory sync | Required for real report generation, reviewer calls, live chat Responses calls, and `bun run agent-memory:sync` when not using `--dry-run`. |
| `OPENAI_MODEL` | Server only | Audit generator model override | Defaults to `gpt-5.5`. |
| `OPENAI_REVIEWER_MODEL` | Server only | Reviewer model override | Defaults to `gpt-5.5`. |
| `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` | Server only | Chat agent file-search memory | Optional vector store ID containing synced `docs/agent-memory/` reference files. Set this from `bun run agent-memory:sync` output in deployed environments. Do not prefix it with `NEXT_PUBLIC_`. |
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
