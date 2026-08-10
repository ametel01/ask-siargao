export const googlePlacesDiscoverySourceProfileId = "source_google_places";
export const googlePlacesDiscoveryFieldMask = "places.id,places.name,nextPageToken";

export type GooglePlacesDiscoverySearch = {
  label: string;
  areaSlug: string;
  textQuery: string;
  center: {
    latitude: number;
    longitude: number;
  };
  radiusMeters: number;
};

export type GooglePlacesDiscoveryPlace = {
  id: string;
  resourceName: string;
};

export type GooglePlacesDiscoverySearchResult = {
  search: GooglePlacesDiscoverySearch;
  places: GooglePlacesDiscoveryPlace[];
  nextPageToken?: string;
};

export type GooglePlacesDiscoveryBatch = {
  fetchedAt: string;
  results: GooglePlacesDiscoverySearchResult[];
  uniquePlaceIds: string[];
};

export type GooglePlacesDiscoveryObservation = {
  id: string;
  sourceRecordId: string;
  candidateEntityId: string;
  placeId: string;
  resourceName: string;
  searchLabel: string;
  areaSlug: string;
  textQuery: string;
  fetchedAt: string;
};

type GooglePlacesTextSearchResponse = {
  places?: Array<{
    id?: string;
    name?: string;
  }>;
  nextPageToken?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const siargaoAccommodationDiscoverySearches: readonly GooglePlacesDiscoverySearch[] = [
  {
    label: "general_luna_lodging",
    areaSlug: "general-luna",
    textQuery: "lodging in General Luna Siargao",
    center: { latitude: 9.8006, longitude: 126.1586 },
    radiusMeters: 7_000,
  },
  {
    label: "cloud_9_lodging",
    areaSlug: "cloud-9",
    textQuery: "lodging near Cloud 9 Siargao",
    center: { latitude: 9.8116, longitude: 126.1651 },
    radiusMeters: 5_000,
  },
  {
    label: "malinao_lodging",
    areaSlug: "malinao",
    textQuery: "lodging in Malinao Siargao",
    center: { latitude: 9.7594, longitude: 126.1348 },
    radiusMeters: 6_000,
  },
] as const;

export function buildGooglePlacesTextSearchBody(search: GooglePlacesDiscoverySearch) {
  return {
    textQuery: search.textQuery,
    includedType: "lodging",
    pageSize: 20,
    locationBias: {
      circle: {
        center: search.center,
        radius: search.radiusMeters,
      },
    },
    regionCode: "PH",
    languageCode: "en",
  };
}

export async function discoverGooglePlacesAccommodationIds({
  apiKey,
  fetchedAt = new Date().toISOString(),
  fetcher = fetch,
  searches = siargaoAccommodationDiscoverySearches,
}: {
  apiKey: string;
  fetchedAt?: string;
  fetcher?: Fetcher;
  searches?: readonly GooglePlacesDiscoverySearch[];
}): Promise<GooglePlacesDiscoveryBatch> {
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for Google Places discovery.");
  }

  const results = await Promise.all(
    searches.map(async (search): Promise<GooglePlacesDiscoverySearchResult> => {
      assertGooglePlacesCostCircuit(
        await reserveGooglePlacesSearchCost({ fieldMask: googlePlacesDiscoveryFieldMask }),
      );
      const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": googlePlacesDiscoveryFieldMask,
        },
        body: JSON.stringify(buildGooglePlacesTextSearchBody(search)),
      });
      const payload = await parseGooglePlacesTextSearchResponse(response);

      return {
        search,
        places: parseGooglePlaces(payload),
        nextPageToken: payload.nextPageToken,
      };
    }),
  );

  const uniquePlaceIds = [...new Set(results.flatMap((result) => result.places.map((p) => p.id)))];

  return {
    fetchedAt,
    results,
    uniquePlaceIds,
  };
}

export function createGooglePlacesDiscoveryObservations(
  batch: GooglePlacesDiscoveryBatch,
): GooglePlacesDiscoveryObservation[] {
  return batch.results.flatMap((result) =>
    result.places.map((place) => {
      const observationId = slugParts("google_places", result.search.label, place.id);

      return {
        id: observationId,
        sourceRecordId: `record_${observationId}`,
        candidateEntityId: `candidate_google_places_${place.id}`,
        placeId: place.id,
        resourceName: place.resourceName,
        searchLabel: result.search.label,
        areaSlug: result.search.areaSlug,
        textQuery: result.search.textQuery,
        fetchedAt: batch.fetchedAt,
      };
    }),
  );
}

async function parseGooglePlacesTextSearchResponse(
  response: Response,
): Promise<GooglePlacesTextSearchResponse> {
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    throw new Error("Google Places response was not a JSON object.");
  }

  const parsed = payload as GooglePlacesTextSearchResponse;
  if (!response.ok || parsed.error) {
    const status = parsed.error?.status ?? response.statusText;
    const message = parsed.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Google Places discovery failed: ${status}: ${message}`);
  }

  return parsed;
}

function parseGooglePlaces(payload: GooglePlacesTextSearchResponse): GooglePlacesDiscoveryPlace[] {
  if (!payload.places) {
    return [];
  }

  return payload.places.map((place, index) => {
    if (!place.id || !place.name) {
      throw new Error(`Google Places result ${index} is missing id or resource name.`);
    }

    return {
      id: place.id,
      resourceName: place.name,
    };
  });
}

function slugParts(...parts: string[]) {
  return parts
    .join("_")
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import {
  assertGooglePlacesCostCircuit,
  reserveGooglePlacesSearchCost,
} from "@/server/providers/google-places-cost-circuit";
