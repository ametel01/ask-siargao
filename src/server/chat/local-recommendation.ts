import type { PlaceCategory } from "@/server/chat/place-intent";
import type {
  GooglePlacesChatContext,
  GooglePlacesOpeningHours,
} from "@/server/providers/google-places-chat";

export type LocalRecommendation = {
  id: string;
  name: string;
  category: PlaceCategory;
  mapsUrl: string;
  address?: string;
  distanceMeters?: number;
  openNow?: boolean;
  businessStatus?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  fitReasons: string[];
  caveats: string[];
  source: {
    provider: "google_places";
    fetchedAt: string;
    freshness: GooglePlacesChatContext["freshness"];
  };
};

export type LocalRecommendationCandidateInput = {
  placeId: string;
  name: string;
  formattedAddress?: string;
  primaryType?: string;
  types: string[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  currentOpeningHours?: GooglePlacesOpeningHours;
  regularOpeningHours?: GooglePlacesOpeningHours;
  googleMapsUri: string;
  distanceMeters?: number;
  source: LocalRecommendation["source"];
};

export function normalizeLocalRecommendation({
  candidate,
  category,
  centerLabel,
  constraints,
  index,
}: {
  candidate: LocalRecommendationCandidateInput;
  category: PlaceCategory;
  centerLabel: string;
  constraints: readonly string[];
  index: number;
}): LocalRecommendation {
  return {
    id: candidate.placeId,
    name: candidate.name,
    category,
    mapsUrl: candidate.googleMapsUri,
    ...(candidate.formattedAddress ? { address: candidate.formattedAddress } : {}),
    ...(candidate.distanceMeters !== undefined ? { distanceMeters: candidate.distanceMeters } : {}),
    ...(candidate.currentOpeningHours?.openNow !== undefined
      ? { openNow: candidate.currentOpeningHours.openNow }
      : {}),
    ...(candidate.businessStatus ? { businessStatus: candidate.businessStatus } : {}),
    ...(candidate.rating !== undefined ? { rating: candidate.rating } : {}),
    ...(candidate.userRatingCount !== undefined ? { reviewCount: candidate.userRatingCount } : {}),
    ...(candidate.priceLevel ? { priceLevel: candidate.priceLevel } : {}),
    fitReasons: recommendationFitReasons(candidate, index, centerLabel),
    caveats: recommendationCaveats(constraints),
    source: candidate.source,
  };
}

function recommendationFitReasons(
  candidate: LocalRecommendationCandidateInput,
  index: number,
  centerLabel: string,
) {
  const fitReasons: string[] = [];
  if (candidate.distanceMeters !== undefined) {
    fitReasons.push(distanceFitLabel(candidate.distanceMeters, centerLabel, index));
  } else if (index === 0) {
    fitReasons.push("top-ranked match");
  }
  fitReasons.push(openingHoursLabel(candidate.currentOpeningHours));
  return fitReasons;
}

function recommendationCaveats(constraints: readonly string[]) {
  const caveats = ["Bookings, review text, and independent local validation not checked."];
  if (constraints.includes("covered_seating")) {
    caveats.push("Covered seating is not verified by Google Places.");
  }
  if (constraints.includes("beachfront")) {
    caveats.push("Beachfront fit is inferred from provider text and not independently verified.");
  }
  return caveats;
}

function openingHoursLabel(hours: GooglePlacesOpeningHours | undefined) {
  if (hours?.openNow === true) {
    return "open now";
  }
  if (hours?.openNow === false) {
    return "currently closed";
  }
  return "hours not returned";
}

function distanceFitLabel(distanceMeters: number, centerLabel: string, index: number) {
  const distanceLabel = `${formatDistance(distanceMeters)} from ${centerLabel}`;
  if (index === 0) {
    return `closest strong match, ${distanceLabel}`;
  }
  if (distanceMeters < 1_000) {
    return `close option, ${distanceLabel}`;
  }
  if (distanceMeters < 4_000) {
    return `short ride, ${distanceLabel}`;
  }
  return `broader-area option, ${distanceLabel}`;
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1_000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1_000).toFixed(1)} km`;
}
