# Plan 014: Bound persisted profile trip context

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8775d60..HEAD -- src/app/api/me/profile/profile-route.ts src/app/api/me/profile/route.test.ts src/server/profile/user-profile-store.ts src/server/db/schema.ts src/features/settings/SettingsDashboardPage.tsx`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts
> against the live code before proceeding; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8775d60`, 2026-07-08
- **Issue**: https://github.com/ametel01/ask-siargao/issues/87

## Why this matters

Most profile fields have explicit string and array limits, but `tripContext` accepts arbitrary JSON
and is persisted directly to `user_profiles.trip_context_json`. Today the settings UI only sends a
single `notes` string, so the server is broader than its actual product surface. Bounding this now
prevents authenticated users from storing unexpectedly large or deeply nested JSON, reduces future
agent-context ambiguity, and keeps the profile contract reviewable.

## Current state

- `src/app/api/me/profile/profile-route.ts` validates PATCH bodies.
- `src/server/profile/user-profile-store.ts` serializes `tripContext` directly into JSONB.
- `src/features/settings/SettingsDashboardPage.tsx` currently sends only `{ notes: string }` or
  `{}`.
- `src/server/db/schema.ts` stores the field as non-null JSONB.

Relevant excerpts:

```ts
// src/app/api/me/profile/profile-route.ts:8-18
const profilePatchSchema = z.strictObject({
  displayName: optionalNullableText(80),
  homeCountry: optionalNullableText(80),
  travelStyle: optionalNullableText(80),
  budgetLevel: optionalNullableText(40),
  dietaryNotes: optionalNullableText(600),
  accessibilityNotes: optionalNullableText(600),
  interests: z.array(trimmedText(60)).max(20).optional(),
  preferredAreas: z.array(trimmedText(80)).max(20).optional(),
  tripContext: z.record(z.string(), z.unknown()).optional(),
  marketingConsent: z.boolean().optional(),
});
```

```ts
// src/server/profile/user-profile-store.ts:153-156
JSON.stringify(next.interests),
JSON.stringify(next.preferredAreas),
JSON.stringify(next.tripContext),
next.marketingConsent,
```

```ts
// src/features/settings/SettingsDashboardPage.tsx:813-824
function profilePatchFromForm(form: ProfileFormState) {
  return {
    displayName: nullableText(form.displayName),
    homeCountry: nullableText(form.homeCountry),
    travelStyle: nullableText(form.travelStyle),
    budgetLevel: nullableText(form.budgetLevel),
    dietaryNotes: nullableText(form.dietaryNotes),
    accessibilityNotes: nullableText(form.accessibilityNotes),
    interests: commaList(form.interests),
    preferredAreas: commaList(form.preferredAreas),
    tripContext: nullableText(form.tripNotes) ? { notes: form.tripNotes.trim() } : {},
    marketingConsent: form.marketingConsent,
  };
}
```

```ts
// src/server/db/schema.ts:51-54
tripContextJson: jsonb("trip_context_json")
  .$type<Record<string, unknown>>()
  .notNull()
  .default({}),
```

Existing profile tests prove normal patches and malformed top-level fields:

```ts
// src/app/api/me/profile/route.test.ts:80-97
test("rejects malformed profile updates", async () => {
  const db = await openProfileTestDatabase();
  const dependencies = profileDependencies(db, { userId: "user_invalid" });

  const response = await patchProfileResponse(
    profileRequest({
      interests: Array.from({ length: 21 }, (_, index) => `interest-${index}`),
```

Repo conventions to match:

- Use Zod schemas at route boundaries.
- Keep profile API tests in `src/app/api/me/profile/route.test.ts`.
- Prefer additive validation and preserve the current `{ notes }` UI behavior.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Profile tests | `bun test src/app/api/me/profile/route.test.ts` | exit 0, all profile API tests pass |
| Settings tests if changed | `bun test src/features/settings/SettingsDashboardPage.test.tsx` | exit 0 if the file exists; if no such test exists, document that and rely on typecheck |
| Lint | `bun run lint` | exit 0, Biome reports no fixes applied |
| Typecheck | `bun run typecheck --incremental false` | exit 0, no TypeScript errors |
| Full tests | `bun test` | exit 0, all Bun tests pass |

## Scope

**In scope**:

- `src/app/api/me/profile/profile-route.ts`
- `src/app/api/me/profile/route.test.ts`
- `src/server/profile/user-profile-store.ts` only if type narrowing requires it
- `src/features/settings/SettingsDashboardPage.tsx` only if the accepted shape changes
- Documentation only if an existing profile/environment reference documents profile payload shape

**Out of scope**:

- Database migrations unless the chosen schema requires a new database constraint. Prefer route and
  type validation first.
- Persisting full trip memory or chat-derived context.
- Changing Clerk identity fields.
- Changing the local `ChatWorkspace` trip-context localStorage format.

## Git workflow

- Branch: `advisor/014-bound-profile-trip-context`
- Commit message style: short imperative, for example `Bound profile trip context`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Replace arbitrary `tripContext` with an explicit schema

In `src/app/api/me/profile/profile-route.ts`, replace
`z.record(z.string(), z.unknown()).optional()` with a strict object matching the current UI
contract. Start with:

- `notes`: optional nullable trimmed string with a bounded length, likely 1,000 or less;

Allow `{}` so clearing notes still works. If you choose to support future known fields, each field
must have an explicit type and max length.

**Verify**:
`bun test src/app/api/me/profile/route.test.ts` should fail until tests are updated for the new
rejection cases.

### Step 2: Add rejection tests for arbitrary and oversized context

In `src/app/api/me/profile/route.test.ts`, add cases proving:

- `{ tripContext: { notes: "Arrives in August" } }` remains accepted;
- unknown keys inside `tripContext` are rejected;
- oversized `notes` is rejected;
- nested arbitrary JSON inside `tripContext` is rejected.

Use the existing PGlite test helpers in that file. Keep assertions focused on the 400 response and
the relevant issue path.

**Verify**:
`bun test src/app/api/me/profile/route.test.ts` exits 0.

### Step 3: Normalize persisted profile context to the bounded shape

If TypeScript still treats `UserProfilePatch.tripContext` as `Record<string, unknown>`, update the
profile types in `src/server/profile/user-profile-store.ts` so the route and store agree on the
bounded shape. Keep `objectFromJson()` defensive for old rows, but ensure returned profile data
only exposes expected keys.

Do not add a migration unless there is already production data that requires cleanup. If a migration
does appear necessary, stop and report the data-shape decision before writing one.

**Verify**:
`bun run typecheck --incremental false` exits 0.

### Step 4: Confirm the settings UI still sends the accepted shape

Review `profilePatchFromForm()` in `src/features/settings/SettingsDashboardPage.tsx`. It already
sends `{ notes: form.tripNotes.trim() }` or `{}`. Only edit it if your schema uses a different
field name.

**Verify**:
`bun run typecheck --incremental false` exits 0. If a settings page test exists, run it.

## Test plan

- Profile API accepts current UI payloads.
- Profile API rejects unknown `tripContext` keys.
- Profile API rejects nested arbitrary objects in `tripContext`.
- Profile API rejects oversized notes.
- Full Bun tests remain green.

## Done criteria

- [ ] `tripContext` is a strict, bounded server-side schema.
- [ ] Current settings UI profile notes still save and reload.
- [ ] Unknown or nested arbitrary profile context is rejected with `400 invalid_profile_request`.
- [ ] Oversized profile notes are rejected.
- [ ] `bun test src/app/api/me/profile/route.test.ts` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run typecheck --incremental false` exits 0.
- [ ] `bun test` exits 0.

## STOP conditions

Stop and report back if:

- Product requirements expect arbitrary structured trip memory to be accepted through this profile
  endpoint.
- Existing production rows need a migration or cleanup strategy before narrowing the return type.
- The code at the cited route/store locations no longer matches the excerpts above.

## Maintenance notes

If persistent trip memory becomes a product requirement, add it as a dedicated schema and store with
clear ownership and tests. Do not use an open-ended profile JSONB field as the long-term memory
contract.
