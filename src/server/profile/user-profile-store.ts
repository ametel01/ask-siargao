import type { WeatherPreference } from "@/features/settings/profile-options";
import { travelerEmailFromStoredEmail } from "@/lib/traveler-identity";
import {
  normalizeStoredProfileTripContext,
  type UserProfileTripContext,
} from "@/server/chat/trip-context";
import type { DatabaseQueryClient } from "@/server/db/query-client";

export type { UserProfileTripContext };

export type UserProfileDetails = {
  displayName: string | null;
  homeCountry: string | null;
  travelStyle: string | null;
  budgetLevel: string | null;
  dietaryNotes: string | null;
  foodNeeds: string[];
  accessibilityNotes: string | null;
  surfAbility: string | null;
  quietSleepPreference: boolean | null;
  weatherPreference: WeatherPreference | null;
  interests: string[];
  preferredAreas: string[];
  tripContext: UserProfileTripContext;
  marketingConsent: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type UserProfileIdentity = {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

export type UserProfileResponse = {
  identity: UserProfileIdentity;
  profile: UserProfileDetails;
};

export type UserProfilePatch = Partial<{
  displayName: string | null;
  homeCountry: string | null;
  travelStyle: string | null;
  budgetLevel: string | null;
  dietaryNotes: string | null;
  foodNeeds: string[];
  accessibilityNotes: string | null;
  surfAbility: string | null;
  quietSleepPreference: boolean | null;
  weatherPreference: WeatherPreference | null;
  interests: string[];
  preferredAreas: string[];
  tripContext: UserProfileTripContext;
  marketingConsent: boolean;
}>;

type UserProfileRow = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  home_country: string | null;
  travel_style: string | null;
  budget_level: string | null;
  dietary_notes: string | null;
  food_needs_json: unknown;
  accessibility_notes: string | null;
  surf_ability: string | null;
  quiet_sleep_preference: boolean | null;
  weather_preference: WeatherPreference | null;
  interests_json: unknown;
  preferred_areas_json: unknown;
  trip_context_json: unknown;
  marketing_consent: boolean | null;
  profile_created_at: Date | string | null;
  profile_updated_at: Date | string | null;
};

export async function loadUserProfile(
  db: DatabaseQueryClient,
  userId: string,
): Promise<UserProfileResponse | null> {
  const result = await db.query<UserProfileRow>(
    `
      select
        users.id as user_id,
        users.email,
        users.first_name,
        users.last_name,
        user_profiles.display_name,
        user_profiles.home_country,
        user_profiles.travel_style,
        user_profiles.budget_level,
        user_profiles.dietary_notes,
        user_profiles.food_needs_json,
        user_profiles.accessibility_notes,
        user_profiles.surf_ability,
        user_profiles.quiet_sleep_preference,
        user_profiles.weather_preference,
        user_profiles.interests_json,
        user_profiles.preferred_areas_json,
        user_profiles.trip_context_json,
        user_profiles.marketing_consent,
        user_profiles.created_at as profile_created_at,
        user_profiles.updated_at as profile_updated_at
      from users
      left join user_profiles on user_profiles.user_id = users.id
      where users.id = $1
    `,
    [userId],
  );
  const row = result.rows[0];

  return row ? profileResponseFromRow(row) : null;
}

export async function upsertUserProfile(
  db: DatabaseQueryClient,
  input: {
    userId: string;
    patch: UserProfilePatch;
    now: Date;
  },
) {
  const existing = await loadUserProfile(db, input.userId);
  const next = {
    ...(existing?.profile ?? emptyProfile()),
    ...input.patch,
  };
  const now = input.now.toISOString();

  await db.query(
    `
      insert into user_profiles (
        user_id,
        display_name,
        home_country,
        travel_style,
        budget_level,
        dietary_notes,
        food_needs_json,
        accessibility_notes,
        surf_ability,
        quiet_sleep_preference,
        weather_preference,
        interests_json,
        preferred_areas_json,
        trip_context_json,
        marketing_consent,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $16)
      on conflict (user_id) do update set
        display_name = excluded.display_name,
        home_country = excluded.home_country,
        travel_style = excluded.travel_style,
        budget_level = excluded.budget_level,
        dietary_notes = excluded.dietary_notes,
        food_needs_json = excluded.food_needs_json,
        accessibility_notes = excluded.accessibility_notes,
        surf_ability = excluded.surf_ability,
        quiet_sleep_preference = excluded.quiet_sleep_preference,
        weather_preference = excluded.weather_preference,
        interests_json = excluded.interests_json,
        preferred_areas_json = excluded.preferred_areas_json,
        trip_context_json = excluded.trip_context_json,
        marketing_consent = excluded.marketing_consent,
        updated_at = excluded.updated_at
    `,
    [
      input.userId,
      next.displayName,
      next.homeCountry,
      next.travelStyle,
      next.budgetLevel,
      next.dietaryNotes,
      JSON.stringify(next.foodNeeds),
      next.accessibilityNotes,
      next.surfAbility,
      next.quietSleepPreference,
      next.weatherPreference,
      JSON.stringify(next.interests),
      JSON.stringify(next.preferredAreas),
      JSON.stringify(next.tripContext),
      next.marketingConsent,
      now,
    ],
  );

  const updated = await loadUserProfile(db, input.userId);
  if (!updated) {
    throw new Error("Updated profile could not be loaded.");
  }

  return updated;
}

function profileResponseFromRow(row: UserProfileRow): UserProfileResponse {
  return {
    identity: {
      email: travelerEmailFromStoredEmail(row.email),
      firstName: row.first_name,
      lastName: row.last_name,
    },
    profile: {
      displayName: row.display_name,
      homeCountry: row.home_country,
      travelStyle: row.travel_style,
      budgetLevel: row.budget_level,
      dietaryNotes: row.dietary_notes,
      foodNeeds: stringArrayFromJson(row.food_needs_json),
      accessibilityNotes: row.accessibility_notes,
      surfAbility: row.surf_ability,
      quietSleepPreference: row.quiet_sleep_preference,
      weatherPreference: row.weather_preference,
      interests: stringArrayFromJson(row.interests_json),
      preferredAreas: stringArrayFromJson(row.preferred_areas_json),
      tripContext: tripContextFromJson(row.trip_context_json),
      marketingConsent: row.marketing_consent ?? false,
      createdAt: timestampToIso(row.profile_created_at),
      updatedAt: timestampToIso(row.profile_updated_at),
    },
  };
}

function emptyProfile(): UserProfileDetails {
  return {
    displayName: null,
    homeCountry: null,
    travelStyle: null,
    budgetLevel: null,
    dietaryNotes: null,
    foodNeeds: [],
    accessibilityNotes: null,
    surfAbility: null,
    quietSleepPreference: null,
    weatherPreference: null,
    interests: [],
    preferredAreas: [],
    tripContext: {},
    marketingConsent: false,
    createdAt: null,
    updatedAt: null,
  };
}

function stringArrayFromJson(value: unknown) {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function tripContextFromJson(value: unknown): UserProfileTripContext {
  return normalizeStoredProfileTripContext(value);
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function timestampToIso(value: Date | string | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
