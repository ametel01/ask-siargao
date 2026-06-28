import { createComponentLogger } from "@/server/observability/logger";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import { googlePlacesChatSearchFieldMask } from "@/server/providers/google-places-policy";

export { googlePlacesChatSearchFieldMask };

export type GooglePlacesChatSearch = {
  label: string;
  textQuery: string;
  includedType?: string;
  openNow?: boolean;
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
  googleMapsUri: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: GooglePlacesOpeningHours;
  regularOpeningHours?: GooglePlacesOpeningHours;
  priceLevel?: string;
  priceRange?: GooglePlacesPriceRange;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  captureJson?: GooglePlacesChatPlaceCapture;
};

export type GooglePlacesChatPlaceCapture = {
  placeId: string;
  resourceName: string;
  displayNameJson?: {
    text?: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  locationJson?: {
    latitude?: number;
    longitude?: number;
  };
  typesJson: string[];
  primaryType?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHoursJson?: GooglePlacesOpeningHours;
  regularOpeningHoursJson?: GooglePlacesOpeningHours;
  priceLevel?: string;
  priceRangeJson?: GooglePlacesPriceRange;
  websiteUri?: string;
  internationalPhoneNumber?: string;
};

export type GooglePlacesOpeningHours = {
  openNow?: boolean;
  weekdayDescriptions?: string[];
  nextOpenTime?: string;
  nextCloseTime?: string;
};

export type GooglePlacesPriceRange = {
  startPrice?: GooglePlacesMoney;
  endPrice?: GooglePlacesMoney;
};

export type GooglePlacesMoney = {
  currencyCode?: string;
  units?: string;
  nanos?: number;
};

export type GooglePlacesChatContext = {
  status: "available" | "no_results";
  sourceName: "Google Places";
  sourceProfileId: typeof googlePlacesDiscoverySourceProfileId;
  fetchedAt: string;
  freshness: "fresh_cache" | "live" | "stale_cache";
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
    rating?: number;
    userRatingCount?: number;
    currentOpeningHours?: GooglePlacesOpeningHours;
    regularOpeningHours?: GooglePlacesOpeningHours;
    priceLevel?: string;
    priceRange?: GooglePlacesPriceRange;
    websiteUri?: string;
    internationalPhoneNumber?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

type ProviderTraceContext = {
  requestId?: string;
};

const googlePlacesChatLogger = createComponentLogger("provider.google_places.chat");

export function buildGooglePlacesChatSearchBody(search: GooglePlacesChatSearch) {
  return {
    textQuery: search.textQuery,
    ...(search.includedType
      ? {
          includedType: search.includedType,
          strictTypeFiltering: true,
        }
      : {}),
    ...(search.openNow ? { openNow: true } : {}),
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
  trace,
}: {
  apiKey?: string;
  fetchedAt?: string;
  fetcher?: Fetcher;
  search: GooglePlacesChatSearch;
  trace?: ProviderTraceContext;
}): Promise<GooglePlacesChatContext> {
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for Google Places chat lookup.");
  }

  const logger = googlePlacesChatLogger.child(
    compactLogFields({
      requestId: trace?.requestId,
      provider: "google_places",
      operation: "places.searchText",
    }),
  );
  const startedAt = Date.now();
  logger.info(
    {
      label: search.label,
      query: search.textQuery,
      includedType: search.includedType,
      center: googlePlacesChatSearchCenterLogFields(),
      radiusMeters: search.radiusMeters,
      pageSize: search.pageSize,
      fieldMask: googlePlacesChatSearchFieldMask,
    },
    "Google Places chat lookup started.",
  );

  try {
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
    const places = filterGooglePlacesChatPlacesForSearch(
      parseGooglePlacesChatPlaces(payload),
      search,
    );

    logger.info(
      {
        label: search.label,
        httpStatus: response.status,
        resultCount: places.length,
        status: places.length > 0 ? "available" : "no_results",
        placeSummaries: places.slice(0, 8).map((place) => ({
          placeId: place.placeId,
          displayName: place.displayName,
          primaryType: place.primaryType,
          businessStatus: place.businessStatus,
          rating: place.rating,
          userRatingCount: place.userRatingCount,
        })),
        durationMs: Date.now() - startedAt,
      },
      "Google Places chat lookup completed.",
    );

    return {
      status: places.length > 0 ? "available" : "no_results",
      sourceName: "Google Places",
      sourceProfileId: googlePlacesDiscoverySourceProfileId,
      fetchedAt,
      freshness: "live",
      search,
      fieldMask: googlePlacesChatSearchFieldMask,
      places,
      caveats: [
        "Google Places listings can confirm place identity, address, map links, ratings, and opening-hour signals when returned.",
        "Review text, bookings, table availability, room availability, and independent local quality checks were not checked.",
      ],
    };
  } catch (error) {
    logger.error(
      {
        error,
        label: search.label,
        query: search.textQuery,
        durationMs: Date.now() - startedAt,
      },
      "Google Places chat lookup failed.",
    );
    throw error;
  }
}

function filterGooglePlacesChatPlacesForSearch(
  places: readonly GooglePlacesChatPlace[],
  search: GooglePlacesChatSearch,
) {
  return search.openNow
    ? places.filter((place) => place.currentOpeningHours?.openNow === true)
    : [...places];
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

    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    const googleMapsUri =
      place.googleMapsUri ??
      buildGoogleMapsSearchUri({
        placeId: place.id,
        displayName,
        formattedAddress: place.formattedAddress,
        latitude,
        longitude,
      });
    const currentOpeningHours = normalizeOpeningHours(place.currentOpeningHours);
    const regularOpeningHours = normalizeOpeningHours(place.regularOpeningHours);
    const priceRange = normalizePriceRange(place.priceRange);

    return [
      {
        placeId: place.id,
        resourceName: place.name,
        displayName,
        formattedAddress: place.formattedAddress,
        latitude,
        longitude,
        types: place.types ?? [],
        primaryType: place.primaryType,
        businessStatus: place.businessStatus,
        googleMapsUri,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        currentOpeningHours,
        regularOpeningHours,
        priceLevel: place.priceLevel,
        priceRange,
        websiteUri: place.websiteUri,
        internationalPhoneNumber: place.internationalPhoneNumber,
        captureJson: {
          placeId: place.id,
          resourceName: place.name,
          displayNameJson: place.displayName,
          formattedAddress: place.formattedAddress,
          locationJson: place.location,
          typesJson: place.types ?? [],
          primaryType: place.primaryType,
          businessStatus: place.businessStatus,
          googleMapsUri,
          rating: place.rating,
          userRatingCount: place.userRatingCount,
          currentOpeningHoursJson: currentOpeningHours,
          regularOpeningHoursJson: regularOpeningHours,
          priceLevel: place.priceLevel,
          priceRangeJson: priceRange,
          websiteUri: place.websiteUri,
          internationalPhoneNumber: place.internationalPhoneNumber,
        },
      },
    ];
  });
}

function buildGoogleMapsSearchUri({
  displayName,
  formattedAddress,
  latitude,
  longitude,
  placeId,
}: {
  displayName: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId: string;
}) {
  const url = new URL("https://www.google.com/maps/search/");
  const query = formattedAddress
    ? `${displayName}, ${formattedAddress}`
    : latitude === undefined || longitude === undefined
      ? displayName
      : `${latitude},${longitude}`;

  url.searchParams.set("api", "1");
  url.searchParams.set("query", query);
  url.searchParams.set("query_place_id", placeId);

  return url.toString();
}

function normalizeOpeningHours(
  openingHours: GooglePlacesOpeningHours | undefined,
): GooglePlacesOpeningHours | undefined {
  if (!openingHours) {
    return undefined;
  }

  const normalized: GooglePlacesOpeningHours = {};
  if (typeof openingHours.openNow === "boolean") {
    normalized.openNow = openingHours.openNow;
  }
  if (Array.isArray(openingHours.weekdayDescriptions)) {
    normalized.weekdayDescriptions = openingHours.weekdayDescriptions;
  }
  if (typeof openingHours.nextOpenTime === "string") {
    normalized.nextOpenTime = openingHours.nextOpenTime;
  }
  if (typeof openingHours.nextCloseTime === "string") {
    normalized.nextCloseTime = openingHours.nextCloseTime;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizePriceRange(
  priceRange: GooglePlacesPriceRange | undefined,
): GooglePlacesPriceRange | undefined {
  if (!priceRange) {
    return undefined;
  }

  const normalized: GooglePlacesPriceRange = {
    startPrice: normalizeMoney(priceRange.startPrice),
    endPrice: normalizeMoney(priceRange.endPrice),
  };

  return normalized.startPrice || normalized.endPrice ? normalized : undefined;
}

function normalizeMoney(money: GooglePlacesMoney | undefined): GooglePlacesMoney | undefined {
  if (!money) {
    return undefined;
  }

  const normalized: GooglePlacesMoney = {};
  if (typeof money.currencyCode === "string") {
    normalized.currencyCode = money.currencyCode;
  }
  if (typeof money.units === "string") {
    normalized.units = money.units;
  }
  if (typeof money.nanos === "number") {
    normalized.nanos = money.nanos;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function googlePlacesChatSearchCenterLogFields() {
  return { source: "redacted_coordinates" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactLogFields(input: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
}
