import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import {
  budgetLevelOptions,
  foodNeedOptions,
  normalizeBudgetLevel,
  normalizeSurfAbility,
  surfAbilityOptions,
  weatherPreferenceOptions,
} from "@/features/settings/profile-options";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { parseUserProfileTripContextPatch } from "@/server/chat/trip-context";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { loadUserProfile, upsertUserProfile } from "@/server/profile/user-profile-store";

const profilePatchSchema = z.strictObject({
  displayName: optionalNullableText(80),
  homeCountry: optionalNullableText(80),
  travelStyle: optionalNullableText(80),
  budgetLevel: optionalNullableNormalizedOption(budgetLevelOptions, normalizeBudgetLevel),
  dietaryNotes: optionalNullableText(600),
  foodNeeds: boundedOptions(foodNeedOptions, 5).optional(),
  accessibilityNotes: optionalNullableText(600),
  surfAbility: optionalNullableNormalizedOption(surfAbilityOptions, normalizeSurfAbility),
  quietSleepPreference: z.boolean().nullable().optional(),
  weatherPreference: optionalNullableOption(weatherPreferenceOptions),
  interests: boundedMultiValues(60, 20).optional(),
  preferredAreas: boundedMultiValues(80, 20).optional(),
  tripContext: z.unknown().optional(),
  marketingConsent: z.boolean().optional(),
});

export type ProfileRouteDependencies = {
  auth?: EnsureCurrentUserDependencies["auth"];
  db: DatabaseQueryClient;
  now: () => Date;
};

function createDefaultProfileRouteDependencies(): ProfileRouteDependencies {
  return {
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
  };
}

export async function getProfileResponse(
  dependencies: ProfileRouteDependencies = createDefaultProfileRouteDependencies(),
) {
  const currentUser = await ensureProfileUser(dependencies);

  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const profile = await loadUserProfile(dependencies.db, currentUser.userId);
  if (!profile) {
    return Response.json({ error: "profile_not_found" }, { status: 404 });
  }

  return Response.json(profile);
}

export async function patchProfileResponse(
  request: Request,
  dependencies: ProfileRouteDependencies = createDefaultProfileRouteDependencies(),
) {
  const currentUser = await ensureProfileUser(dependencies);

  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidProfileRequest([{ path: "", message: "Expected a valid JSON request body." }]);
  }

  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return invalidProfileRequest(profileValidationIssues(parsed.error.issues));
  }

  const tripContext = parseUserProfileTripContextPatch(parsed.data.tripContext);
  if (!tripContext.success) {
    return invalidProfileRequest(tripContext.issues);
  }

  const { tripContext: rawTripContext, ...profilePatch } = parsed.data;
  const existingProfile =
    rawTripContext === undefined
      ? null
      : await loadUserProfile(dependencies.db, currentUser.userId);
  const nextTripContext =
    rawTripContext === undefined
      ? undefined
      : Object.keys(tripContext.data).length === 0
        ? {}
        : { ...(existingProfile?.profile.tripContext ?? {}), ...tripContext.data };
  const profile = await upsertUserProfile(dependencies.db, {
    userId: currentUser.userId,
    patch: {
      ...profilePatch,
      ...(nextTripContext === undefined ? {} : { tripContext: nextTripContext }),
    },
    now: dependencies.now(),
  });

  return Response.json(profile);
}

async function ensureProfileUser(dependencies: ProfileRouteDependencies) {
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: dependencies.db,
    now: dependencies.now,
  });
}

function invalidProfileRequest(issues: Array<{ path: string; message: string }>) {
  return Response.json(
    {
      error: "invalid_profile_request",
      issues,
    },
    { status: 400 },
  );
}

function profileValidationIssues(
  issues: Array<{ path: readonly PropertyKey[]; message: string; keys?: unknown }>,
) {
  return issues.flatMap((issue) => {
    const keys = issue.keys;
    if (Array.isArray(keys)) {
      const pathPrefix = issue.path.length > 0 ? `${issue.path.join(".")}.` : "";
      return keys
        .filter((key): key is string => typeof key === "string")
        .map((key) => ({ path: `${pathPrefix}${key}`, message: issue.message }));
    }

    return [{ path: issue.path.join("."), message: issue.message }];
  });
}

function optionalNullableText(maxLength: number) {
  return z.union([trimmedText(maxLength).transform((value) => value || null), z.null()]).optional();
}

function optionValue<Value extends string>(options: readonly { value: Value }[]) {
  return z
    .string()
    .refine(
      (value): value is Value => options.some((option) => option.value === value),
      "Choose a supported value.",
    );
}

function optionalNullableNormalizedOption<Value extends string>(
  options: readonly { value: Value }[],
  normalize: (value: string | null | undefined) => Value | undefined,
) {
  return z
    .union([z.string(), z.null()])
    .transform((value, context): Value | null => {
      if (value === null) {
        return null;
      }
      const normalized = normalize(value);
      if (normalized && options.some((option) => option.value === normalized)) {
        return normalized;
      }
      context.addIssue({ code: "custom", message: "Choose a supported value." });
      return z.NEVER;
    })
    .optional();
}

function optionalNullableOption<Value extends string>(options: readonly { value: Value }[]) {
  return z.union([optionValue(options), z.null()]).optional();
}

function boundedMultiValues(maxLength: number, maxItems: number) {
  return z
    .array(z.string().trim().min(1, "Enter a value.").max(maxLength))
    .max(maxItems)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        const normalized = value.normalize("NFKC").toLocaleLowerCase();
        if (seen.has(normalized)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Each value must be unique.",
          });
        }
        seen.add(normalized);
      }
    });
}

function boundedOptions<Value extends string>(
  options: readonly { value: Value }[],
  maxItems: number,
) {
  return z
    .array(optionValue(options))
    .max(maxItems)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Each value must be unique.",
          });
        }
        seen.add(value);
      }
    });
}

function trimmedText(maxLength: number) {
  return z.string().trim().max(maxLength);
}
