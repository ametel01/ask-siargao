# Database Row-Level Security Decision

Ask Siargao defers production table RLS activation for user-owned tables until database sessions can
reliably carry request-scoped identity and tests can prove every private route keeps its current
ownership behavior.

## Current Boundary

Application authorization currently happens before database writes:

- Clerk authenticates profile, chat history, rating, and signed-in saved-trip routes.
- Route handlers derive user identity from Clerk auth, not from request body user IDs.
- Cross-user chat thread, message rating, saved-trip delete, and saved-trip share attempts return
  `404`.
- Public shared-trip links expose selected public artifacts only and do not include owner IDs,
  profile details, chat transcripts, exact browser coordinates, raw provider payloads, private source
  observations, Google review text/author data, or secret tokens.

These route-level boundaries are documented in
[`routes-and-surfaces.md`](../reference/routes-and-surfaces.md). Database role boundaries are
documented in [`database-authorization.md`](../reference/database-authorization.md).

## User-Owned Tables

The current user-owned table set is:

- `users`
- `user_profiles`
- `chat_threads`
- `chat_messages`
- `chat_response_ratings`
- `saved_trips`
- `saved_trip_items`
- `shared_trip_plans`
- `trip_passes`
- `trip_usage_meters`

These names are also exported as `userOwnedTables` from
`src/server/db/authorization-boundaries.ts` so tests can keep the decision record aligned with the
grant template.

## Decision

RLS is deferred for this hardening step.

The runtime role is still least-privilege at the role/grant layer: it is not the schema owner, does
not have migration ledger access, and receives application DML grants only after broad `PUBLIC`
privileges are revoked. That reduces the blast radius of the runtime credential without changing
request behavior.

Enabling RLS now would require more than table policies. The app would need a reliable way to set
the authenticated Clerk user ID or public-trip ownership context on every database session before
each user-owned query. It would also need policies for background jobs, anonymous local-trip flows,
public share-token reads, paid audit/report access, Clerk webhook sync, and provider ingestion paths
that legitimately operate without a signed-in traveler.

## Activation Prerequisites

Before activating RLS, add tests and implementation for:

- request-scoped database identity setup for Clerk-authenticated requests;
- clearing or resetting identity state when pooled sessions are reused;
- anonymous saved-trip ownership context for local trip keys;
- share-token read policies that allow only non-expired, non-deleted public plans;
- Clerk webhook sync policies for `users` and `user_profiles`;
- paid audit/report access policies that preserve signed-token report delivery;
- background job and provider ingestion policies that do not depend on traveler identity;
- negative tests proving cross-user reads and writes fail at the database layer, not only at route
  guards;
- migration and seed tests proving local PGlite and production Postgres setup paths remain
  compatible.

Until those prerequisites exist, route-level authorization remains the enforcement boundary for
user ownership, and database hardening stays at the role/grant layer.
