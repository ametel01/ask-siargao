import type { TripContextDraft } from "@/features/chat/trip-context-draft";
import type { TripDataSource, TripProfileResponse } from "@/features/chat/trip-state";

export type MobileTripContextPass =
  | { status: "available"; summary: string }
  | { status: "unavailable" }
  | { status: "not_connected" };

export type MobileTripContextSummary = {
  actionLabel: "Add trip details" | "View trip details";
  facts: Array<{ label: "Area" | "Dates" | "Trip Pass"; value: string }>;
  state: "empty" | "loading" | "partial" | "populated" | "unavailable";
};

export function projectMobileTripContextSummary({
  context,
  pass,
  source,
}: {
  context: TripContextDraft;
  pass?: MobileTripContextPass;
  source: TripDataSource;
}): MobileTripContextSummary {
  if (source === "loading") {
    return { actionLabel: "View trip details", facts: [], state: "loading" };
  }

  if (source === "error") {
    return { actionLabel: "View trip details", facts: [], state: "unavailable" };
  }

  const knownTripFieldCount = [
    context.accommodation,
    context.dateRange,
    context.travelerType,
    context.nearbyArea === "Siargao Island" ? "" : context.nearbyArea,
  ].filter(Boolean).length;
  const facts = [
    ...(context.nearbyArea !== "Siargao Island"
      ? [{ label: "Area" as const, value: context.nearbyArea }]
      : []),
    ...(context.dateRange ? [{ label: "Dates" as const, value: context.dateRange }] : []),
    ...(pass?.status === "available" ? [{ label: "Trip Pass" as const, value: pass.summary }] : []),
  ];
  const hasKnownContext = knownTripFieldCount > 0 || pass?.status === "available";

  return {
    actionLabel: hasKnownContext ? "View trip details" : "Add trip details",
    facts,
    state: !hasKnownContext ? "empty" : knownTripFieldCount === 4 ? "populated" : "partial",
  };
}

export function authenticatedTripContextPatch(
  profile: TripProfileResponse | undefined,
  context: TripContextDraft,
): Record<string, unknown> {
  const current = profileTripContextRecord(profile);
  return {
    ...current,
    accommodation: context.accommodation || null,
    dateRange: context.dateRange || null,
    travelerType: context.travelerType || null,
    currentArea: context.nearbyArea === "Siargao Island" ? null : context.nearbyArea,
  };
}

function profileTripContextRecord(
  profile: TripProfileResponse | undefined,
): Record<string, unknown> {
  const value = profile?.tripContext ?? profile?.profile?.tripContext;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const {
    geolocation: _geolocation,
    latitude: _latitude,
    longitude: _longitude,
    ...safe
  } = value as Record<string, unknown>;
  return safe;
}
