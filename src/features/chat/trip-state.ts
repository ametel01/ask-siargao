import {
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
        (profile?.tripContext ?? profile?.profile?.tripContext) as
          | Partial<TripContextDraft>
          | undefined,
      ),
      source: "authenticated",
    };
  }

  if (profileStatus === "anonymous") {
    return { context: normalizeTripContextDraft(localContext), source: "anonymous" };
  }

  return { context: normalizeTripContextDraft(), source: profileStatus };
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
