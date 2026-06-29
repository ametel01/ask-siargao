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
        tripContext: { notes: "Arrives in August" },
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
      tripContext: { notes: "Arrives in August" },
      marketingConsent: true,
    });

    const getResponse = await getProfileResponse(dependencies);
    expect(await getResponse.json()).toEqual(body);

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
