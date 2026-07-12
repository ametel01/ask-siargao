import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { getProfileResponse, patchProfileResponse } from "@/app/api/me/profile/profile-route";
import { runInitialMigration } from "@/server/db/test-database";

describe("profile API route", () => {
  test("returns 401 for anonymous profile reads and writes", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: null });

    const getResponse = await getProfileResponse(dependencies);
    const patchResponse = await patchProfileResponse(
      profileRequest({ displayName: "Alex" }),
      dependencies,
    );

    expect(getResponse.status).toBe(401);
    expect(await getResponse.json()).toEqual({ error: "unauthenticated" });
    expect(patchResponse.status).toBe(401);
    expect(await patchResponse.json()).toEqual({ error: "unauthenticated" });

    await db.close();
  });

  test("creates a profile on first edit and returns Clerk-owned identity fields", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, {
      userId: "user_profile",
      email: "profile@example.com",
      firstName: "Clerk",
      lastName: "Traveler",
      imageUrl: "https://img.clerk.test/profile",
    });

    const patchResponse = await patchProfileResponse(
      profileRequest({
        displayName: "Siargao Planner",
        homeCountry: "Philippines",
        travelStyle: "Surf mornings",
        budgetLevel: "mid_range",
        dietaryNotes: "Vegetarian",
        accessibilityNotes: "Avoid steep stairs",
        interests: ["surf", "food"],
        preferredAreas: ["General Luna", "Cloud 9"],
        tripContext: {
          notes: "Arrives in August",
          currentArea: "Cloud 9",
          accommodation: "Near Cloud 9",
          dateRange: "Aug 1 - 6",
          travelerType: "Family with kids",
          transportMode: "tricycle",
          rideTimeLimitMinutes: 25,
          durableConstraints: ["with_kids", "budget_cheap"],
        },
        marketingConsent: true,
      }),
      dependencies,
    );
    const body = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(body.identity).toEqual({
      userId: "user_profile",
      email: "profile@example.com",
      firstName: "Clerk",
      lastName: "Traveler",
      imageUrl: "https://img.clerk.test/profile",
    });
    expect(body.profile).toMatchObject({
      displayName: "Siargao Planner",
      homeCountry: "Philippines",
      travelStyle: "Surf mornings",
      budgetLevel: "mid_range",
      dietaryNotes: "Vegetarian",
      accessibilityNotes: "Avoid steep stairs",
      interests: ["surf", "food"],
      preferredAreas: ["General Luna", "Cloud 9"],
      tripContext: {
        notes: "Arrives in August",
        currentArea: "Cloud 9",
        accommodation: "Near Cloud 9",
        dateRange: "Aug 1 - 6",
        travelerType: "family_with_kids",
        transportMode: "tricycle",
        rideTimeLimitMinutes: 25,
        durableConstraints: ["with_kids", "budget_cheap"],
      },
      marketingConsent: true,
    });

    const getResponse = await getProfileResponse(dependencies);
    expect(await getResponse.json()).toEqual(body);

    await db.close();
  });

  test("clears trip notes with an empty trip context", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: "user_trip_context" });

    const notesResponse = await patchProfileResponse(
      profileRequest({ tripContext: { notes: "Arrives in August" } }),
      dependencies,
    );
    const notesBody = await notesResponse.json();

    expect(notesResponse.status).toBe(200);
    expect(notesBody.profile.tripContext).toEqual({ notes: "Arrives in August" });

    const clearResponse = await patchProfileResponse(
      profileRequest({ tripContext: {} }),
      dependencies,
    );
    const clearBody = await clearResponse.json();

    expect(clearResponse.status).toBe(200);
    expect(clearBody.profile.tripContext).toEqual({});

    const getResponse = await getProfileResponse(dependencies);
    const getBody = await getResponse.json();
    expect(getBody.profile.tripContext).toEqual({});

    await db.close();
  });

  test("preserves untouched trip and durable preferences across partial updates", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: "user_preservation" });

    await patchProfileResponse(
      profileRequest({
        homeCountry: "Australia",
        surfAbility: "Intermediate",
        quietSleepPreference: true,
        weatherPreference: "avoid_rain",
        tripContext: {
          accommodation: "Near Cloud 9",
          dateRange: "Aug 1 - 6",
          currentArea: "Cloud 9",
          travelerType: "Couple",
          transportMode: "scooter",
          rideTimeLimitMinutes: 25,
          durableConstraints: ["rain_avoidance", "quiet_sleep"],
          notes: "Late arrival",
        },
      }),
      dependencies,
    );

    const durableResponse = await patchProfileResponse(
      profileRequest({ surfAbility: "Advanced", quietSleepPreference: false }),
      dependencies,
    );
    const durableBody = await durableResponse.json();
    expect(durableBody.profile.tripContext).toEqual({
      accommodation: "Near Cloud 9",
      dateRange: "Aug 1 - 6",
      currentArea: "Cloud 9",
      travelerType: "couple",
      transportMode: "scooter",
      rideTimeLimitMinutes: 25,
      durableConstraints: ["rain_avoidance", "quiet_sleep"],
      notes: "Late arrival",
    });

    const tripResponse = await patchProfileResponse(
      profileRequest({ tripContext: { notes: "Early check-in if possible" } }),
      dependencies,
    );
    const tripBody = await tripResponse.json();
    expect(tripBody.profile).toMatchObject({
      homeCountry: "Australia",
      surfAbility: "advanced",
      quietSleepPreference: false,
      weatherPreference: "avoid_rain",
    });
    expect(tripBody.profile.tripContext).toEqual({
      accommodation: "Near Cloud 9",
      dateRange: "Aug 1 - 6",
      currentArea: "Cloud 9",
      travelerType: "couple",
      transportMode: "scooter",
      rideTimeLimitMinutes: 25,
      durableConstraints: ["rain_avoidance", "quiet_sleep"],
      notes: "Early check-in if possible",
    });

    await db.close();
  });

  test("rejects arbitrary trip context payloads", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: "user_invalid_trip_context" });
    const invalidCases: Array<{
      name: string;
      tripContext: unknown;
      expectedPaths: string[];
    }> = [
      {
        name: "unknown keys",
        tripContext: { notes: "Allowed", arrivalDate: "2026-08-01" },
        expectedPaths: ["tripContext.arrivalDate"],
      },
      {
        name: "nested arbitrary JSON",
        tripContext: { notes: { nested: true } },
        expectedPaths: ["tripContext.notes"],
      },
      {
        name: "raw browser coordinates",
        tripContext: { currentArea: "Cloud 9", geolocation: { latitude: 9.81, longitude: 126.16 } },
        expectedPaths: ["tripContext.geolocation"],
      },
      {
        name: "arrays",
        tripContext: [{ notes: "No arrays" }],
        expectedPaths: ["tripContext"],
      },
      {
        name: "oversized notes",
        tripContext: { notes: "x".repeat(1001) },
        expectedPaths: ["tripContext.notes"],
      },
    ];

    for (const invalidCase of invalidCases) {
      const response = await patchProfileResponse(
        profileRequest({ tripContext: invalidCase.tripContext }),
        dependencies,
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("invalid_profile_request");
      const issuePaths = body.issues.map((issue: { path: string }) => issue.path);
      for (const expectedPath of invalidCase.expectedPaths) {
        expect(issuePaths).toContain(expectedPath);
      }
    }

    await db.close();
  });

  test("normalizes legacy persisted trip context rows to the bounded shape", async () => {
    const db = await openProfileTestDatabase();
    await seedLegacyProfile(db, "user_legacy_trip_context", {
      notes: "  Keep beach days flexible  ",
      currentArea: "Cloud 9",
      accommodation: "  Near Cloud 9  ",
      arrivalDate: "2026-08-01",
      nested: { arbitrary: true },
    });
    const dependencies = profileDependencies(db, { userId: "user_legacy_trip_context" });

    const response = await getProfileResponse(dependencies);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile.tripContext).toEqual({
      notes: "Keep beach days flexible",
      currentArea: "Cloud 9",
      accommodation: "Near Cloud 9",
    });

    await db.close();
  });

  test("rejects malformed profile updates", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: "user_invalid" });

    const response = await patchProfileResponse(
      profileRequest({
        interests: Array.from({ length: 21 }, (_, index) => `interest-${index}`),
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_profile_request");
    expect(body.issues[0].path).toBe("interests");

    await db.close();
  });

  test("rejects empty and duplicate multi-value writes with field-addressable issues", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: "user_invalid_multi_values" });

    const response = await patchProfileResponse(
      profileRequest({
        interests: ["Surf", " surf ", ""],
        preferredAreas: ["Cloud 9", "Cloud 9"],
        foodNeeds: ["vegan", "vegan"],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.issues.map((issue: { path: string }) => issue.path).toSorted()).toEqual([
      "foodNeeds.1",
      "interests.1",
      "interests.2",
      "preferredAreas.1",
    ]);

    await db.close();
  });

  test("returns field-addressable issues for invalid durable preferences", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: "user_invalid_preferences" });

    const response = await patchProfileResponse(
      profileRequest({
        surfAbility: "x".repeat(81),
        weatherPreference: "always_sunny",
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_profile_request");
    expect(body.issues.map((issue: { path: string }) => issue.path).toSorted()).toEqual([
      "surfAbility",
      "weatherPreference",
    ]);

    await db.close();
  });

  test("round-trips only stable structured values and rejects new unknown choices", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, { userId: "user_structured_preferences" });

    const response = await patchProfileResponse(
      profileRequest({
        budgetLevel: "premium",
        surfAbility: "intermediate",
        foodNeeds: ["vegan", "gluten_free"],
        tripContext: {
          travelerType: "family_with_kids",
          rideTimeLimitMinutes: 360,
          transportMode: "van",
        },
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      budgetLevel: "premium",
      surfAbility: "intermediate",
      foodNeeds: ["vegan", "gluten_free"],
      tripContext: {
        travelerType: "family_with_kids",
        rideTimeLimitMinutes: 360,
        transportMode: "van",
      },
    });

    const invalidResponse = await patchProfileResponse(
      profileRequest({
        budgetLevel: "good_value",
        surfAbility: "expert",
        foodNeeds: ["pescatarian"],
        tripContext: { travelerType: "work retreat", rideTimeLimitMinutes: 361 },
      }),
      dependencies,
    );
    const invalidBody = await invalidResponse.json();

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.issues.map((issue: { path: string }) => issue.path).toSorted()).toEqual([
      "budgetLevel",
      "foodNeeds.0",
      "surfAbility",
    ]);

    const invalidTripResponse = await patchProfileResponse(
      profileRequest({ tripContext: { travelerType: "work retreat", rideTimeLimitMinutes: 361 } }),
      dependencies,
    );
    const invalidTripBody = await invalidTripResponse.json();
    expect(invalidTripResponse.status).toBe(400);
    expect(invalidTripBody.issues.map((issue: { path: string }) => issue.path).toSorted()).toEqual([
      "tripContext.rideTimeLimitMinutes",
      "tripContext.travelerType",
    ]);

    await db.close();
  });

  test("preserves unknown legacy values when an unrelated field changes", async () => {
    const db = await openProfileTestDatabase();
    await seedLegacyProfile(
      db,
      "user_legacy_structured",
      {
        travelerType: "Remote work retreat",
        currentArea: "Cloud 9",
        transportMode: "scooter",
        rideTimeLimitMinutes: 45,
        notes: "Keep this note",
      },
      {
        budgetLevel: "slow_travel",
        surfAbility: "Ocean whisperer",
        interests: ["Surf, yoga", "  Food  "],
        preferredAreas: ["Cloud 9", "Secret corner"],
      },
    );
    const dependencies = profileDependencies(db, { userId: "user_legacy_structured" });

    const loaded = await getProfileResponse(dependencies);
    const before = await loaded.json();
    expect(before.profile).toMatchObject({
      budgetLevel: "slow_travel",
      surfAbility: "Ocean whisperer",
      interests: ["Surf, yoga", "  Food  "],
      preferredAreas: ["Cloud 9", "Secret corner"],
      tripContext: { travelerType: "Remote work retreat" },
    });

    const saved = await patchProfileResponse(
      profileRequest({ displayName: "A new name" }),
      dependencies,
    );
    const after = await saved.json();
    expect(after.profile).toMatchObject({
      displayName: "A new name",
      budgetLevel: "slow_travel",
      surfAbility: "Ocean whisperer",
      interests: ["Surf, yoga", "  Food  "],
      preferredAreas: ["Cloud 9", "Secret corner"],
      tripContext: {
        travelerType: "Remote work retreat",
        currentArea: "Cloud 9",
        transportMode: "scooter",
        rideTimeLimitMinutes: 45,
        notes: "Keep this note",
      },
    });

    await db.close();
  });

  test("does not allow profile patches to mutate Clerk-owned identity fields", async () => {
    const db = await openProfileTestDatabase();
    const dependencies = profileDependencies(db, {
      userId: "user_identity",
      email: "original@example.com",
      firstName: "Original",
    });

    const response = await patchProfileResponse(
      profileRequest({
        displayName: "Allowed",
        email: "attacker@example.com",
        firstName: "Attacker",
      }),
      dependencies,
    );
    const body = await response.json();
    const user = await loadUser(db, "user_identity");

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_profile_request");
    expect(body.issues.map((issue: { path: string }) => issue.path).toSorted()).toEqual([
      "email",
      "firstName",
    ]);
    expect(user).toMatchObject({
      email: "original@example.com",
      first_name: "Original",
    });

    await db.close();
  });
});

async function openProfileTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

function profileDependencies(
  db: PGlite,
  input: {
    userId: string | null;
    email?: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
  },
) {
  return {
    auth: async () => ({
      userId: input.userId,
      sessionClaims: input.userId
        ? {
            email: input.email ?? `${input.userId}@example.com`,
            given_name: input.firstName ?? null,
            family_name: input.lastName ?? null,
            picture: input.imageUrl ?? null,
          }
        : null,
    }),
    db,
    now: () => new Date("2026-06-29T04:00:00.000Z"),
  };
}

function profileRequest(body: unknown) {
  return new Request("https://siargao.test/api/me/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function loadUser(db: PGlite, userId: string) {
  const result = await db.query<{ email: string; first_name: string | null }>(
    "select email, first_name from users where id = $1",
    [userId],
  );

  return result.rows[0] ?? null;
}

async function seedLegacyProfile(
  db: PGlite,
  userId: string,
  tripContext: Record<string, unknown>,
  profile: Partial<{
    budgetLevel: string;
    surfAbility: string;
    interests: string[];
    preferredAreas: string[];
  }> = {},
) {
  await db.query(
    `
      insert into users (id, email, created_at, updated_at)
      values ($1, $2, $3, $3)
    `,
    [userId, `${userId}@example.com`, "2026-06-29T04:00:00.000Z"],
  );
  await db.query(
    `
      insert into user_profiles (
        user_id, budget_level, surf_ability, interests_json, preferred_areas_json,
        trip_context_json, created_at, updated_at
      )
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $7)
    `,
    [
      userId,
      profile.budgetLevel ?? null,
      profile.surfAbility ?? null,
      JSON.stringify(profile.interests ?? []),
      JSON.stringify(profile.preferredAreas ?? []),
      JSON.stringify(tripContext),
      "2026-06-29T04:00:00.000Z",
    ],
  );
}
