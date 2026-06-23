# Plan 006: Derive public eligibility from governed source policy

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/public-pages/public-content.ts src/server/public-pages/public-content.test.ts src/server/facts/fact-graph.ts src/server/providers/adapters.ts src/server/providers/source-governance.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-drizzle-schema-parity.md`
- **Category**: security
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

Public human pages, LLM Markdown, JSON APIs, sitemap, and `llms.txt` are the app's answer-engine trust surface. They currently trust manual `publicRepublishAllowed` booleans on static facts, while the source-governance layer derives republication rights from source profiles. That lets fixture or future public facts bypass the provider/source permission model.

## Current State

- `src/server/facts/fact-graph.ts` derives governed fact permissions.
- `src/server/providers/adapters.ts` marks official transport as `citation_only`, not public republish.
- `src/server/public-pages/public-content.ts` stores static public page facts with manual flags.

Relevant excerpts:

```ts
// src/server/facts/fact-graph.ts:44
publicRepublishAllowed: decision.publicRepublishAllowed,
```

```ts
// src/server/facts/fact-graph.ts:67
export function canPublishFactPublicly(fact: GovernedFact, confidence: ConfidenceLabel) {
  return fact.publicRepublishAllowed && confidence !== "low";
}
```

```ts
// src/server/providers/adapters.ts:33
allowedUse: "citation_only",
```

```ts
// src/server/public-pages/public-content.ts:185
if (!fact.publicRepublishAllowed) {
  reasons.push(`fact:${fact.id}:public_republish_not_allowed`);
}
```

Product constraints:

- Public pages may include only facts marked as allowed for public republication.
- Agent-readable content must match human-visible factual claims.
- Private audit data, raw provider payloads, and non-republishable evidence must never appear in public surfaces.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/public-pages/public-content.test.ts src/server/providers/source-governance.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/public-pages/public-content.ts`
- `src/server/public-pages/public-content.test.ts`
- `src/server/facts/fact-graph.ts` only if a helper needs to be exported or reused
- `src/server/providers/source-governance.test.ts`
- Static public fixture source profiles/facts only as needed to make tests honest

**Out of scope**:

- Persisted public page generation; plan 011 covers that.
- Adding real provider ingestion; plan 010 covers that.
- Changing public page visual design.
- Weakening source governance to make current fixtures pass.

## Git Workflow

- Branch: `advisor/006-governed-public-eligibility`
- Commit message style: `fix: derive public eligibility from source policy`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add source identity to public facts

Extend `PublicFactRecord` so public facts carry enough source identity to verify policy, such as `sourceProfileId` or a `GovernedFact` reference. Avoid relying solely on a handwritten `publicRepublishAllowed` boolean.

For static fixtures, use source profiles whose permissions are explicitly public-republish if the claim is meant to appear publicly.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 2: Evaluate public eligibility through governance helpers

Update `evaluatePublicEligibility` to derive public publishability through `canPublishFactPublicly` or equivalent source-registry decisions. Keep existing checks for:

- low confidence
- private user data
- raw provider payload
- weak entity match
- missing critical public evidence

Do not make `citation_only` equivalent to public republication.

**Verify**: `bun test src/server/public-pages/public-content.test.ts` -> exit 0 after tests are updated.

### Step 3: Add policy regression tests

Add tests proving:

- a `citation_only` official source can support paid-audit citation but cannot be republished publicly
- a `public_republish` source can appear in human page, Markdown, JSON, JSON-LD, sitemap, and `llms.txt`
- public output does not include blocked facts

Use `src/server/providers/source-governance.test.ts` as the source-policy pattern.

**Verify**: `bun test src/server/public-pages/public-content.test.ts src/server/providers/source-governance.test.ts` -> exit 0.

### Step 4: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Extend `src/server/public-pages/public-content.test.ts` with a blocked citation-only fixture and an allowed public-republish fixture. The important assertion is that all public surfaces are generated from only eligible facts.

## Done Criteria

- [ ] Public eligibility derives republication rights from source governance, not only handwritten flags.
- [ ] Citation-only official facts are excluded from public republish surfaces.
- [ ] Public-republish facts still render across all public formats.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Current public fixture pages cannot remain visible without changing their source profiles.
- The fix requires provider terms/legal decisions that are not represented in code.
- The code has already moved public pages to persisted governed facts.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Reviewers should inspect any new public fact fixture for source profile and allowed-use consistency. Static flags should not outrank source policy.

