# Routes And Surfaces Reference

## Product Pages

| Route | Purpose | Indexing |
| --- | --- | --- |
| `/` | Ask Siargao chat-first landing page | Public |
| `/chat` | Ask Siargao assistant workspace with anonymous chat and signed-in chat history | Public |
| `/trips/shared/[token]` | Public shared saved-trip plan with selected cards/itineraries only | `noindex, nofollow` metadata |
| `/profile` | Signed-in Ask Siargao profile settings for app-specific travel preferences | Private authenticated surface |
| `/audits/[auditRequestId]/status` | Post-checkout processing/status page | Private audit surface |
| `/audits/[auditRequestId]/report?token=...` | Signed-token paid report delivery for published, paid, reviewer-approved audits | `x-robots-tag: noindex, nofollow` |
| `/audits/demo/report` | Synthetic report fixture for local QA only | `x-robots-tag: noindex, nofollow` |
| `/admin/diagnostics` | Operator diagnostics console | `x-robots-tag: noindex, nofollow` |

## Audit APIs

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/audit/intake` | `POST` | Validate intake, resolve accommodation context, run completeness gate, and return preview risk when eligible | Intake rate limit |
| `/api/audit/checkout` | `POST` | Create Stripe Checkout only for complete, eligible audits | Checkout rate limit |
| `/api/stripe/webhook` | `POST` | Verify Stripe webhook signatures and record payment success | Provider-call rate limit and webhook secret |

## Auth APIs

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/clerk/webhooks` | `POST` | Verify Clerk webhook signatures and sync local user identity cache rows for user create, update, and delete events | Public at the Clerk proxy layer; Clerk webhook signature required |
| `/api/me/profile` | `GET`, `PATCH` | Return Clerk-derived identity fields and read or update Ask Siargao-specific profile details | Clerk-authenticated user only |

## Chat APIs

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/chat` | `POST` | Validate chat turns, run the Ask Siargao agent, and persist owner-scoped thread/messages when a Clerk session is present | Public for anonymous stateless chat; Clerk-authenticated requests persist owned turns |
| `/api/chat/threads` | `GET`, `POST` | List the current user's non-deleted chat threads newest first or create an empty owned thread | Clerk-authenticated user only |
| `/api/chat/threads/[threadId]` | `GET`, `PATCH`, `DELETE` | Hydrate an owned chat thread with messages, rename or archive it, or soft-delete it | Clerk-authenticated owner only; cross-user access returns `404` |
| `/api/chat/ratings` | `PUT` | Create or update the current user's rating for an owned assistant message | Clerk-authenticated owner only; cross-user access returns `404` and user-message targets return `400` |

Authenticated chat persistence stores user and assistant-visible message content, public sources,
selected public artifacts, redacted tool-call summaries without raw arguments, and browser-location
context summaries without exact coordinates.

## Saved Trip Sharing APIs

The `/chat` workspace lets unauthenticated travelers save recommendation cards and itinerary
artifacts locally, then sync only selected saved items when creating a share link. Local browser
state uses an anonymous `local_trip_*` ID; the server hashes that client trip key before storing
saved items.

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/trips/saved?tripId=...` | `GET` | List non-deleted saved items for an anonymous local trip or an owned signed-in trip | Public API rate limit; owned trip keys require matching Clerk user |
| `/api/trips/saved` | `GET` | List the current signed-in user's latest saved trip without requiring `tripId` | Clerk-authenticated user only |
| `/api/trips/saved` | `POST` | Upsert selected saved card/itinerary/note artifacts and associate them with the current user when signed in | Public API rate limit; signed-in local-trip migration only claims unowned or already owned trips |
| `/api/trips/saved/[itemId]` | `DELETE` | Soft-delete a saved item by anonymous trip ownership or current signed-in user ownership | Public API rate limit; cross-user owned trips return `404` |
| `/api/trips/share` | `POST` | Create a public share token for selected saved item IDs after verifying anonymous or signed-in ownership | Public API rate limit; cross-user owned trips return `404` |
| `/api/trips/share/[token]` | `GET` | Return a shared plan DTO for a valid, non-expired, non-deleted token | Public API rate limit |

Shared plans render only selected saved artifacts, map links, source summaries, freshness
timestamps, checked/not-checked arrays, and caveats. Save/share schemas reject full chat
transcripts, client geolocation, tool-call arguments, raw provider payloads, Google review fields,
owner IDs, profile details, and exact coordinates. Expired or deleted share tokens return a generic
unavailable/not-found response without exposing token status.

## Authenticated Data Privacy Checklist

- Chat history stores user and assistant-visible message content, public sources, selected public
  artifacts, redacted tool-call summaries, and browser-location summaries only.
- Chat history does not persist exact browser coordinates, raw provider payloads, non-public Google
  review text, or Google review author attribution.
- Chat thread, rating, profile, and authenticated saved-trip routes derive ownership from Clerk
  auth, never request body user IDs.
- Cross-user chat thread, message rating, saved-trip delete, and saved-trip share attempts return
  `404`.
- Public shared-trip links expose only selected public saved artifacts and do not include owner IDs,
  profile details, chat transcripts, browser geolocation, raw provider payloads, or exact
  coordinates.

## Public Knowledge Surfaces

Each public page family is generated from the same repository-backed `PublicKnowledgePage` governed facts. The local demo repository is built from persisted-page-shaped fixtures, while production should read the same shape from governed public page and evidence rows.

| Family | Human Route | LLM Markdown Route | JSON Route |
| --- | --- | --- | --- |
| Accommodations | `/accommodations/[slug]` | `/accommodations/[slug]/llm.md` | `/api/public/accommodations/[slug].json` |
| Areas | `/areas/[slug]` | `/areas/[slug]/llm.md` | `/api/public/areas/[slug].json` |
| Routes | `/routes/[slug]` | `/routes/[slug]/llm.md` | `/api/public/routes/[slug].json` |
| Operators | `/operators/[slug]` | `/operators/[slug]/llm.md` | `/api/public/operators/[slug].json` |
| Risks | `/risks/[slug]` | `/risks/[slug]/llm.md` | `/api/public/risks/[slug].json` |

Public index routes:

- `/api/public/entities`
- `/api/public/evidence`
- `/api/public/risk-preview`
- `/api/public/weather/siargao`
- `/sitemap.xml`
- `/llms.txt`
- `/robots.txt`

Public APIs use the `public_api` rate-limit policy. Public eligibility blocks private user data, raw provider payloads, non-republishable facts, low-confidence facts, and weak entity matches.
