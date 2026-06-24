import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";

export const googlePlacesChatSearchFieldMask =
  "places.id,places.name,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.businessStatus,places.googleMapsUri";

export type GooglePlacesChatSearch = {
  label: string;
  textQuery: string;
  includedType?: string;
  center: {
    latitude: number;
    longitude: number;
  };
  radiusMeters: number;
  pageSize: number;
};

export type GooglePlacesChatPlace = {
  placeId: string;
  resourceName: string;
  displayName: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  types: string[];
  primaryType?: string;
  businessStatus?: string;
  googleMapsUri?: string;
};

export type GooglePlacesChatContext = {
  status: "available" | "no_results";
  sourceName: "Google Places";
  sourceProfileId: typeof googlePlacesDiscoverySourceProfileId;
  fetchedAt: string;
  search: GooglePlacesChatSearch;
  fieldMask: typeof googlePlacesChatSearchFieldMask;
  places: GooglePlacesChatPlace[];
  caveats: string[];
};

type GooglePlacesChatSearchResponse = {
  places?: Array<{
    id?: string;
    name?: string;
    displayName?: {
      text?: string;
      languageCode?: string;
    };
    formattedAddress?: string;
    location?: {
      latitude?: number;
      longitude?: number;
    };
    types?: string[];
    primaryType?: string;
    businessStatus?: string;
    googleMapsUri?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function buildGooglePlacesChatSearchBody(search: GooglePlacesChatSearch) {
  return {
    textQuery: search.textQuery,
    ...(search.includedType
      ? {
          includedType: search.includedType,
          strictTypeFiltering: true,
        }
      : {}),
    pageSize: search.pageSize,
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

export async function getGooglePlacesChatContext({
  apiKey = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY,
  fetchedAt = new Date().toISOString(),
  fetcher = fetch,
  search,
}: {
  apiKey?: string;
  fetchedAt?: string;
  fetcher?: Fetcher;
  search: GooglePlacesChatSearch;
}): Promise<GooglePlacesChatContext> {
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for Google Places chat lookup.");
  }

  const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": googlePlacesChatSearchFieldMask,
    },
    body: JSON.stringify(buildGooglePlacesChatSearchBody(search)),
  });
  const payload = await parseGooglePlacesChatSearchResponse(response);
  const places = parseGooglePlacesChatPlaces(payload);

  return {
    status: places.length > 0 ? "available" : "no_results",
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt,
    search,
    fieldMask: googlePlacesChatSearchFieldMask,
    places,
    caveats: [
      "Basic chat lookup includes place identity, address, type, business status, and Google Maps link only.",
      "It does not include reviews, ratings, prices, opening hours, bookings, or availability.",
      "Do not store this raw provider response as reusable product data.",
    ],
  };
}

async function parseGooglePlacesChatSearchResponse(
  response: Response,
): Promise<GooglePlacesChatSearchResponse> {
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    throw new Error("Google Places chat lookup response was not a JSON object.");
  }

  const parsed = payload as GooglePlacesChatSearchResponse;
  if (!response.ok || parsed.error) {
    const status = parsed.error?.status ?? response.statusText;
    const message = parsed.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Google Places chat lookup failed: ${status}: ${message}`);
  }

  return parsed;
}

function parseGooglePlacesChatPlaces(
  payload: GooglePlacesChatSearchResponse,
): GooglePlacesChatPlace[] {
  if (!payload.places) {
    return [];
  }

  return payload.places.flatMap((place, index) => {
    if (!place.id || !place.name) {
      throw new Error(`Google Places chat result ${index} is missing id or resource name.`);
    }

    const displayName = place.displayName?.text;
    if (!displayName) {
      return [];
    }

    return [
      {
        placeId: place.id,
        resourceName: place.name,
        displayName,
        formattedAddress: place.formattedAddress,
        latitude: place.location?.latitude,
        longitude: place.location?.longitude,
        types: place.types ?? [],
        primaryType: place.primaryType,
        businessStatus: place.businessStatus,
        googleMapsUri: place.googleMapsUri,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
