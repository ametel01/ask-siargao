# Clerk Authentication and Account Lifecycle Reference

This page describes the shipped Clerk integration. It is an as-built reference, not a future
requirements document.

## Deployment policy

`CLERK_AUTH_MODE` and `NEXT_PUBLIC_CLERK_AUTH_MODE` are explicit `enabled`/`disabled` enums.
Production and protected staging require both to be `enabled`; untrusted previews remain disabled
and receive no Clerk secrets. `CLERK_AUTHORIZED_PARTIES` contains exact origins only. Production
and protected staging additionally bind to their stable origin, Vercel project, and optional target
environment or branch identity. Wildcards, generated preview hosts, and key-presence inference fail
closed. A Vercel Custom Environment may expose `VERCEL_ENV=production`; protected staging accepts
that production-class runtime only when `VERCEL_TARGET_ENV` exactly matches its configured
non-production target. A production Clerk context is rejected on that target.

## User flows

- Email-code and configured Google OAuth sign-in create a Clerk session and converge a local account.
- Google acceptance requires a human-completed provider callback that created one verified Google
  external account. The protected lane separately proves the current provider redirect, queries
  Clerk for that exact verified link, and establishes a session for the same Clerk subject with the
  official testing helper. A testing-helper session without the redirect and linked-account checks
  is not equivalent evidence.
- Protected routes and APIs require an authenticated Clerk account. Cross-account saved-item access
  is denied by ownership checks.
- Users can view and update verified email/profile data, inspect their sessions, revoke other
  sessions, and sign out the current session through Clerk-backed account management.
- Session policy is verified against the protected Clerk instance, including the seven-day maximum
  expiry. Persistence alone is not policy evidence.
- Operator mutations require an account in `OPERATOR_ACCOUNT_IDS` and fresh Clerk MFA. The local
  `ADMIN_ACCESS_TOKEN` compatibility path is read-only and never authorizes production mutation.

## Identity convergence and webhooks

`/api/clerk/webhooks` is public only at the routing perimeter. The handler verifies the signed Svix
envelope with `CLERK_WEBHOOK_SIGNING_SECRET`, size and timestamp constraints, and idempotent event
application. It stores normalized identity state rather than raw provider payloads. Signed create,
update, and delete events converge the local account. Duplicate delivery is safe, while stale or
conflicting delivery fails closed for investigation.

Login convergence and webhook convergence use immutable Clerk subject IDs. Email is profile data,
not ownership authority.

## Account Closure

Account Closure is terminal. The closure operation wins a database-time race, revokes access,
purges or minimizes user data, deletes the Clerk identity through a retryable worker, and retains
only policy-approved tombstone and commerce evidence. Payment that becomes authoritative after
closure creates a durable **Paid After Closure** full-refund obligation and never grants access.

Closure matching uses `ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY` and its versioned previous-key ring.
The transient provider subject uses a separate versioned encryption key. Rotation keeps only the
approved grace keys until outstanding work drains; secrets and readable provider subjects are never
logged.

## Operations, monitoring, and rollback

Run the scheduler-neutral `bun run operations:worker` and the bounded closure/refund workers from
an operator-selected scheduler. Monitor webhook verification/retry age, identity convergence,
closure attempts, Paid After Closure refund attempts, and scrubbed Sentry pages. Provider payloads,
emails, tokens, and raw IDs must not appear in logs or evidence artifacts.

Rollback is forward repair: disable the affected surface, retain the durable operations, reconcile
provider facts before local findings, and repair through an allowlisted fresh-MFA Operator action.
Do not restore a closed account or delete tombstones to simulate rollback. After a database restore,
keep traffic disabled until `bun run privacy:restore-guard` confirms the versioned privacy snapshot
covers the restored closure watermark.

## Release evidence

Normal pull-request CI uses deterministic denial and contract tests without provider secrets. After
merge, an eligible human may dispatch the protected provider release-candidate workflow from
`main` for an exact trusted SHA. It uses dedicated test-instance users, test-mode Stripe resources,
a dedicated protected-test database, and a SHA-bound non-production origin. This protected run is
required human evidence; repository CI must not claim it ran.
