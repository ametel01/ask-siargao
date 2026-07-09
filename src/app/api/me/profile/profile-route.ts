import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { parseUserProfileTripContextPatch } from "@/server/chat/trip-context";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { loadUserProfile, upsertUserProfile } from "@/server/profile/user-profile-store";

const profilePatchSchema = z.strictObject({
  displayName: optionalNullableText(80),
  homeCountry: optionalNullableText(80),
  travelStyle: optionalNullableText(80),
  budgetLevel: optionalNullableText(40),
  dietaryNotes: optionalNullableText(600),
  accessibilityNotes: optionalNullableText(600),
  surfAbility: optionalNullableText(80),
  quietSleepPreference: z.boolean().nullable().optional(),
  weatherPreference: z.enum(["avoid_rain", "flexible"]).nullable().optional(),
  interests: z.array(trimmedText(60)).max(20).optional(),
  preferredAreas: z.array(trimmedText(80)).max(20).optional(),
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

  const { tripContext: _tripContext, ...profilePatch } = parsed.data;
  const profile = await upsertUserProfile(dependencies.db, {
    userId: currentUser.userId,
    patch: {
      ...profilePatch,
      ...(_tripContext === undefined ? {} : { tripContext: tripContext.data }),
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

function trimmedText(maxLength: number) {
  return z.string().trim().max(maxLength);
}
