import {
  forecastLocationLabels,
  normalizeTripContextDraft,
  type TripContextDraft,
} from "@/features/chat/trip-context-draft";

export type TripDataSource = "loading" | "anonymous" | "authenticated" | "error";

export type TripProfileResponse = {
  profile?: { tripContext?: unknown };
  tripContext?: unknown;
};

export type TripState = {
  context: TripContextDraft;
  source: TripDataSource;
};

type TripContextInput = Partial<TripContextDraft>;

export function projectTripState({
  localContext,
  profile,
  profileStatus,
}: {
  localContext: TripContextInput;
  profile?: TripProfileResponse;
  profileStatus: TripDataSource;
}): TripState {
  if (profileStatus === "authenticated") {
    return {
      context: normalizeTripContextDraft(
        profileTripContextDraft(profile?.tripContext ?? profile?.profile?.tripContext),
      ),
      source: "authenticated",
    };
  }

  if (profileStatus === "anonymous") {
    return { context: normalizeTripContextDraft(localContext), source: "anonymous" };
  }

  return { context: normalizeTripContextDraft(), source: profileStatus };
}

function profileTripContextDraft(value: unknown): TripContextInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const context = value as Record<string, unknown>;
  const nearbyArea =
    profileForecastLocation(context.currentArea) ?? profileForecastLocation(context.nearbyArea);
  return {
    ...(typeof context.accommodation === "string" ? { accommodation: context.accommodation } : {}),
    ...(typeof context.dateRange === "string" ? { dateRange: context.dateRange } : {}),
    ...(typeof context.travelerType === "string" ? { travelerType: context.travelerType } : {}),
    ...(nearbyArea ? { nearbyArea } : {}),
  };
}

function profileForecastLocation(value: unknown): TripContextDraft["nearbyArea"] | undefined {
  return typeof value === "string" &&
    forecastLocationLabels.includes(value as (typeof forecastLocationLabels)[number])
    ? (value as TripContextDraft["nearbyArea"])
    : undefined;
}

export function tripContextFacts(context: TripContextDraft) {
  return [
    ...(context.accommodation ? [{ label: "Accommodation", value: context.accommodation }] : []),
    ...(context.dateRange ? [{ label: "Dates", value: context.dateRange }] : []),
    ...(context.travelerType ? [{ label: "Traveler type", value: context.travelerType }] : []),
    ...(context.nearbyArea !== "Siargao Island"
      ? [{ label: "Nearby area", value: context.nearbyArea }]
      : []),
  ];
}

export function hasTripContext(context: TripContextDraft) {
  return tripContextFacts(context).length > 0;
}
