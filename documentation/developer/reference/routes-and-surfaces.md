# Routes And Surfaces Reference

## Product Pages

| Route | Purpose | Indexing |
| --- | --- | --- |
| `/` | Ask Siargao chat-first landing page | Public |
| `/chat` | Ask Siargao assistant workspace mockup with trip context, chat, weather, and surf panels | Public |
| `/trips/shared/[token]` | Public shared saved-trip plan with selected cards/itineraries only | `noindex, nofollow` metadata |
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

## Saved Trip Sharing APIs

The `/chat` workspace lets unauthenticated travelers save recommendation cards and itinerary
artifacts locally, then sync only selected saved items when creating a share link. Local browser
state uses an anonymous `local_trip_*` ID; the server hashes that client trip key before storing
saved items.

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/trips/saved?tripId=...` | `GET` | List non-deleted saved items for an anonymous local trip | Public API rate limit |
| `/api/trips/saved` | `POST` | Upsert selected saved card/itinerary/note artifacts for a local trip | Public API rate limit |
| `/api/trips/saved/[itemId]` | `DELETE` | Soft-delete a saved item for a local trip | Public API rate limit |
| `/api/trips/share` | `POST` | Create a public share token for selected saved item IDs | Public API rate limit |
| `/api/trips/share/[token]` | `GET` | Return a shared plan DTO for a valid, non-expired, non-deleted token | Public API rate limit |

Shared plans render only selected saved artifacts, map links, source summaries, freshness
timestamps, checked/not-checked arrays, and caveats. Save/share schemas reject full chat
transcripts, client geolocation, tool-call arguments, raw provider payloads, Google review fields,
and exact coordinates. Expired or deleted share tokens return a generic unavailable/not-found
response without exposing token status.

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
