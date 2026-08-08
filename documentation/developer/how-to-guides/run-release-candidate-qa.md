# Run Release-Candidate QA

Use this guide to produce truthful engineering evidence and, after merge, obtain the separate human
provider evidence needed for a launch decision. This procedure does not authorize checkout.

## 1. Verify the candidate locally

From a clean exact candidate SHA, run:

```sh
bun install --frozen-lockfile
bun run verify:ci
```

Run real-service integration lanes against disposable test Postgres and Redis as described in the
[script reference](../reference/scripts.md). Do not point these commands at production resources.

## 2. Write deterministic engineering evidence

Keep checkout explicitly off:

```sh
TRIP_PASS_CHECKOUT_MODE=off bun run qa:trip-pass-launch -- --write
```

The command writes `.tmp/trip-pass-launch/trip-pass-launch-manifest-<full-sha>.json`. Its source
receipt contains the exact checked-out SHA and source commit time; its migration receipt contains
the complete ordered filenames and SHA-256 checksums. Configuration is represented only as boolean
presence, with no values. Repeating the command for the same commit and migration set produces the
same JSON and checksum.

The artifact has two deliberately separate conclusions:

- `engineeringReadiness` reports repository gates only;
- `humanLaunchAuthorization` remains false and `checkout.mode` remains `off`.

`--foundation-ci-gates-passed` is reserved for the trusted CI job that depends on the actual
foundation jobs. A local manifest therefore records those gates as blocked rather than claiming
they passed.

## 3. Run protected provider QA after merge

An eligible human dispatches `.github/workflows/provider-release-candidate.yml` from the default
branch and enters the full SHA already contained in `main`. Environment approval supplies only
dedicated Clerk test-instance, Stripe test-mode, protected-test database, and protected-staging
origin credentials after trust proof. The workflow denies forks, non-manual events, non-`main`
SHAs, production-looking resources, live Stripe keys, schema drift, and deployed-SHA drift.

Clerk proves real email-code and Google OAuth sessions, route and ownership policy, account
management, signed webhook convergence, seven-day session maximum, and terminal deletion. Stripe
proves Checkout creation, a distinct 30-minute expiry boundary, authenticated cancellation,
return-before-event, activation, duplicate/reversed delivery, ambiguous retry, cumulative refunds,
disputes, closure race, Paid After Closure refund, and paid-answer settlement. The workflow emits
receipts only for scenarios actually executed and re-probes SHA/database boundaries before each
mutating group and final evidence.

No protected credential is available to pull-request CI, and repository evidence must not imply
this human run occurred.

## 4. Hand evidence to the launch process

Attach the exact-SHA engineering artifact, its checksum, CI links, protected provider receipts, and
migration-ledger fingerprint to the dedicated GitHub launch issue described in
[Launch Trip Pass](launch-trip-pass.md). Keep provider values and fixture identifiers out of the
issue. A non-author human must make the final authorization decision.
