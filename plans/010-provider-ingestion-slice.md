# Plan 010: Build the first real provider ingestion slice

> **Executor instructions**: Follow this plan step by step. This is a direction/spike plan: the output may be a narrow production slice or a written technical decision if provider access blocks implementation. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/providers src/server/facts src/server/audit/accommodation-resolution.ts src/server/audit/completeness-gate.ts documentation/developer/how-to-guides/run-release-candidate-qa.md docs/PRD.md docs/TECH.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-drizzle-schema-parity.md`, `plans/006-governed-public-eligibility.md`
- **Category**: direction
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

Accommodation resolution success and evidence quality determine whether travelers can pay for the audit. Current provider adapters are policy contracts, and accommodation resolution uses two local records. The next high-leverage product slice is one permitted ingestion path that proves facts can enter the governed fact graph and improve completeness decisions without ToS-risky scraping.

## Current State

- `src/server/providers/adapters.ts` defines provider/source profiles.
- `src/server/facts/fact-graph.ts` normalizes source records and governed facts.
- `src/server/audit/accommodation-resolution.ts` uses local fixture accommodation records.
- Docs state provider integrations remain approval-dependent.

Relevant excerpts:

```ts
// src/server/providers/adapters.ts:25
export const officialTransportAdapter: ProviderAdapterContract = {
```

```ts
// src/server/audit/accommodation-resolution.ts:18
const localAccommodationRecords = [
```

```md
<!-- documentation/developer/how-to-guides/run-release-candidate-qa.md:54 -->
Agoda, Tripadvisor/Terra, social, marketplace, and partner-source integrations remain approval-dependent and must not be scraped unless terms allow it.
```

Product constraints:

- Use permitted data only: official APIs, licensed feeds, public sources whose terms allow automated collection, user-submitted details, local verified records, and direct partner/host data.
- Do not use ToS-risky scraping for core product data.
- Source credibility is separate from fact confidence.
- If accommodation resolution fails, request extra user evidence.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Provider tests | `bun test src/server/providers/source-governance.test.ts` | exit 0 |
| Audit tests | `bun test src/server/audit/intake.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/providers/`
- `src/server/facts/`
- `src/server/audit/accommodation-resolution.ts`
- `src/server/audit/completeness-gate.ts`
- Tests under `src/server/providers/`, `src/server/facts/`, and `src/server/audit/`
- Developer docs documenting the selected provider/user-submitted slice

**Out of scope**:

- Scraping Airbnb or any prohibited source.
- Integrating multiple provider families at once.
- Building public page generation; plan 011 covers that.
- Building a production worker backend.
- Storing secret values in docs or tests.

## Git Workflow

- Branch: `advisor/010-provider-ingestion-slice`
- Commit message style: `feat: add first governed provider ingestion slice`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Pick the permitted first slice

Choose exactly one source path:

- local verified accommodation records, or
- user-submitted accommodation evidence, or
- an approved API/provider if credentials and terms are already available

Write a short decision note in developer docs naming:

- source type
- allowed use
- raw storage policy
- public republication policy
- freshness window
- what facts it can create

If no permitted provider path is available, STOP and report; do not scrape.

**Verify**: `rg -n "first provider|provider ingestion|allowed use" documentation docs` -> the decision is documented.

### Step 2: Implement ingestion into the fact graph

Create a small ingestion function that takes the chosen provider/user-submitted input and produces:

- `NormalizedSourceRecord`
- one or more `GovernedFact`
- optional `GovernedEvidence`

Use `SourceRegistry`, `normalizeSourceRecord`, `createGovernedFact`, and `createGovernedEvidence`. Do not bypass source-policy decisions.

**Verify**: `bun test src/server/providers/source-governance.test.ts` -> exit 0.

### Step 3: Feed accommodation resolution/completeness

Adapt `resolveAccommodation` so it can consume governed accommodation candidates/facts from the chosen slice while preserving current fixture behavior for tests. The completeness gate should benefit from the ingested facts without allowing low-confidence or disallowed facts to make checkout eligible.

**Verify**: `bun test src/server/audit/intake.test.ts` -> exit 0.

### Step 4: Add measurement hooks

Add minimal counters/events or diagnostic fields for:

- accommodation resolution success/failure
- source confidence
- completeness pass/fail reason

Use existing sanitized observability patterns; do not log accommodation names, platform URLs, emails, or free-form traveler details.

**Verify**: `bun test src/server/security/security.test.ts` -> exit 0 if telemetry sanitization is touched.

### Step 5: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Add tests proving:

- disallowed/unprofiled sources cannot enter the fact graph
- the chosen permitted source creates governed facts/evidence
- low-confidence or weak-match facts do not make checkout eligible
- successful governed accommodation facts can improve completeness
- telemetry remains sanitized

Use `src/server/providers/source-governance.test.ts` and `src/server/audit/intake.test.ts` as patterns.

## Done Criteria

- [ ] Exactly one permitted provider/user-submitted ingestion slice is implemented or a documented STOP decision is produced.
- [ ] Ingested facts enter through source governance helpers.
- [ ] Accommodation resolution/completeness uses the slice without bypassing confidence and allowed-use policy.
- [ ] Tests cover allowed, disallowed, and low-confidence cases.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No secret values are committed or printed.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- The only available data path is ToS-risky scraping.
- Provider terms or credentials are required but unavailable.
- Implementing the slice requires storing raw data that source policy forbids.
- The change expands to multiple providers.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

This is the first proof of the data-access strategy. Reviewers should focus on allowed use, freshness, confidence, and whether the slice improves checkout eligibility without overclaiming.

