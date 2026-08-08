# Run Release-Candidate QA

Use this guide to establish Foundation Gate Status for a Prospective Candidate and, after merge,
obtain protected provider evidence for the Release Candidate. This procedure does not establish
Production Readiness or grant Launch Authorization.

The [2026-08-09 production-readiness assessment](../explanation/whole-application-production-readiness-assessment-2026-08-09.md)
records the historical evidence and decisions behind these gates.

## 1. Verify the Prospective Candidate

Start from one clean immutable pre-merge commit. A dirty worktree, branch name, mutable deployment
alias, or latest-green run is not a Prospective Candidate.

Run the local aggregate:

```sh
bun install --frozen-lockfile
bun run verify:ci
```

Despite its current name, `verify:ci` does not run the real PostgreSQL and Redis lanes and is not a
complete Foundation Gate. Run both separately against disposable test services:

```sh
bun run test:integration:postgres
bun run test:integration:redis
```

Configure those commands as described in the [script reference](../reference/scripts.md). Do not
point them at production resources. The planned `verify:foundation` aggregate is not available until
its package script and service orchestration land.

## 2. Write deterministic foundation evidence

Keep checkout explicitly off:

```sh
TRIP_PASS_CHECKOUT_MODE=off bun run qa:trip-pass-launch -- --write
```

The command writes `.tmp/trip-pass-launch/trip-pass-launch-manifest-<full-sha>.json`. Its source
receipt contains the exact checked-out SHA and source commit time; its migration receipt contains
the complete ordered filenames and SHA-256 checksums. Configuration is represented only as boolean
presence, with no values. Repeating the command for the same commit and migration set produces the
same JSON and checksum.

The artifact has two deliberately separate conclusions. Its existing machine field retains the
`engineeringReadiness` name for compatibility, but this documentation calls that narrow result
Foundation Gate Status:

- `engineeringReadiness` reports Foundation Gate Status only;
- `humanLaunchAuthorization` remains false and `checkout.mode` remains `off`.

`--foundation-ci-gates-passed` is reserved for the trusted CI job that depends on the actual
foundation jobs. A local manifest therefore records those gates as blocked rather than claiming
they passed.

## 3. Establish the Release Candidate after merge

After merge, use the immutable commit already contained in trusted `main`. That post-merge commit is
the Release Candidate only when it is the commit deployed to the protected environment. If merge,
rebase, another commit, the migration ledger, or relevant provider configuration changes the tested
identity, rerun every affected gate. Pre-merge evidence for a different SHA does not transfer.

## 4. Run protected provider QA

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
this human run occurred. Provider QA must be rerun after a relevant provider-configuration change.

## 5. Verify recovery and evidence freshness

Production Readiness requires observed recovery, not just a runbook. Before first authorization,
exercise application rollback. Repeat the rollback exercise at least quarterly and keep a successful
database restore drill from the previous 30 days. When rollback, restore, provider, SHA, or relevant
configuration evidence expires or changes, Production Readiness is revoked.

## 6. Hand evidence to the launch process

Attach the exact-SHA engineering artifact, its checksum, CI links, protected provider receipts, and
migration-ledger fingerprint to the dedicated GitHub launch issue described in
[Launch Trip Pass](launch-trip-pass.md) or [Launch the free product](launch-free-product.md). Keep
provider values and fixture identifiers out of the issue.

Name an Evidence Owner to assemble and attest the evidence. A distinct Launch Approver must review
it and cannot be the candidate author, Evidence Owner, or exposure Operator. Unused Launch
Authorization expires after 24 hours and is revoked by a new Release Candidate, expired evidence, or
a newly discovered non-waivable risk.
