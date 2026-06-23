# Environment Reference

The app reads these environment variables.

| Variable | Surface | Required For | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public/client-safe | Checkout URLs and canonical public URLs | Defaults exist in some local code paths, but set this in deployed environments. |
| `DATABASE_URL` | Server only | Production database client | Required by `createDatabaseClient`. Test migration and seed commands use PGlite. |
| `STRIPE_RESTRICTED_KEY` | Server only | Stripe Checkout API calls | Preferred server key for Checkout permissions. |
| `STRIPE_SECRET_KEY` | Server only | Stripe Checkout API calls | Fallback when `STRIPE_RESTRICTED_KEY` is not set. |
| `STRIPE_WEBHOOK_SECRET` | Server only | Stripe webhook verification | Required by `/api/stripe/webhook`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public/client-safe | Client-side Stripe surfaces | Present in `.env.example`; current Checkout flow is server initiated. |
| `OPENAI_API_KEY` | Server only | OpenAI Responses API client | Required for real report generation and reviewer calls. |
| `OPENAI_MODEL` | Server only | Audit generator model override | Defaults to `gpt-5.5`. |
| `OPENAI_REVIEWER_MODEL` | Server only | Reviewer model override | Defaults to `gpt-5.5`. |
| `INNGEST_EVENT_KEY` | Server only | Future job worker integration | Placeholder until the production worker backend is wired. |
| `INNGEST_SIGNING_KEY` | Server only | Future job worker integration | Placeholder until the production worker backend is wired. |
| `REDIS_URL` | Server only | Future worker/rate-limit infrastructure | In-memory rate limiting is used in the current app code. |
| `ADMIN_ACCESS_TOKEN` | Server only | Production admin diagnostics access | Send the same value in the `x-admin-token` request header. |
| `SENTRY_DSN` | Server only | Observability sink configuration | Current event helper records whether it is configured. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Public/client-safe | PostHog sink configuration | Current event helper records whether it is configured. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Public/client-safe | PostHog host | Defaults in `.env.example` to the US PostHog ingest host. |

Server-only secrets must not use the `NEXT_PUBLIC_` prefix. `getServerSecret` rejects public-prefixed names so sensitive provider keys do not move into client-facing bundles.
