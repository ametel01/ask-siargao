import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  googlePlacesAtmosphereDetailsFieldMask,
  googlePlacesDetailsFieldMask,
  googlePlacesEnterpriseDetailsFieldMask,
} from "@/server/providers/google-places-policy";
import { fetchWithProviderTimeout } from "@/server/providers/provider-fetch";

export { googlePlacesAtmosphereDetailsFieldMask, googlePlacesDetailsFieldMask };

export type GooglePlacesDetails = {
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
  currentOpeningHours?: GooglePlacesOpeningHours;
  regularOpeningHours?: GooglePlacesOpeningHours;
  priceLevel?: string;
  priceRange?: GooglePlacesPriceRange;
  rating?: number;
  userRatingCount?: number;
  fetchedAt: string;
};

export type GooglePlacesCaptureDetails = GooglePlacesDetails & {
  displayNameJson?: GooglePlacesLocalizedText;
  shortFormattedAddress?: string;
  addressComponentsJson?: Record<string, unknown>[];
  locationJson?: GooglePlacesLocation;
  viewportJson?: Record<string, unknown>;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  currentOpeningHoursJson?: GooglePlacesOpeningHours;
  regularOpeningHoursJson?: GooglePlacesOpeningHours;
  priceLevel?: string;
  priceRangeJson?: GooglePlacesPriceRange;
  rating?: number;
  userRatingCount?: number;
  paymentOptionsJson?: Record<string, unknown>;
  parkingOptionsJson?: Record<string, unknown>;
  amenitiesJson?: Record<string, unknown>;
  attributionsJson?: Record<string, unknown>[];
  reviews: GooglePlacesReview[];
  fieldMask: string;
};

export type GooglePlacesReview = {
  name?: string;
  relativePublishTimeDescription?: string;
  rating?: number;
  text?: GooglePlacesLocalizedText;
  originalText?: GooglePlacesLocalizedText;
  authorAttribution?: Record<string, unknown>;
  publishTime?: string;
};

type GooglePlacesLocalizedText = {
  text?: string;
  languageCode?: string;
};

type GooglePlacesLocation = {
  latitude?: number;
  longitude?: number;
};

type GooglePlacesOpeningHours = {
  openNow?: boolean;
  weekdayDescriptions?: string[];
  nextOpenTime?: string;
  nextCloseTime?: string;
};

type GooglePlacesPriceRange = {
  startPrice?: GooglePlacesMoney;
  endPrice?: GooglePlacesMoney;
};

type GooglePlacesMoney = {
  currencyCode?: string;
  units?: string;
  nanos?: number;
};

type GooglePlacesDetailsResponse = {
  id?: string;
  name?: string;
  displayName?: GooglePlacesLocalizedText;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: Record<string, unknown>[];
  location?: GooglePlacesLocation;
  viewport?: Record<string, unknown>;
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  currentOpeningHours?: GooglePlacesOpeningHours;
  regularOpeningHours?: GooglePlacesOpeningHours;
  priceLevel?: string;
  priceRange?: GooglePlacesPriceRange;
  rating?: number;
  userRatingCount?: number;
  paymentOptions?: Record<string, unknown>;
  parkingOptions?: Record<string, unknown>;
  reviews?: GooglePlacesReview[];
  attributions?: Record<string, unknown>[];
  allowsDogs?: boolean;
  curbsidePickup?: boolean;
  delivery?: boolean;
  dineIn?: boolean;
  goodForChildren?: boolean;
  goodForGroups?: boolean;
  goodForWatchingSports?: boolean;
  liveMusic?: boolean;
  outdoorSeating?: boolean;
  restroom?: boolean;
  servesBeer?: boolean;
  servesBreakfast?: boolean;
  servesBrunch?: boolean;
  servesCocktails?: boolean;
  servesCoffee?: boolean;
  servesDessert?: boolean;
  servesDinner?: boolean;
  servesLunch?: boolean;
  servesVegetarianFood?: boolean;
  servesWine?: boolean;
  takeout?: boolean;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function enrichGooglePlacesDetails({
  apiKey,
  placeIds,
  fetchedAt = new Date().toISOString(),
  fetcher = fetch,
}: {
  apiKey: string;
  placeIds: readonly string[];
  fetchedAt?: string;
  fetcher?: Fetcher;
}) {
  const captureDetails = await enrichGooglePlacesCaptureDetails({
    apiKey,
    placeIds,
    fetchedAt,
    fetcher,
    fieldMask: googlePlacesDetailsFieldMask,
  });

  return captureDetails.map(
    (detail): GooglePlacesDetails => ({
      placeId: detail.placeId,
      resourceName: detail.resourceName,
      displayName: detail.displayName,
      formattedAddress: detail.formattedAddress,
      latitude: detail.latitude,
      longitude: detail.longitude,
      types: detail.types,
      primaryType: detail.primaryType,
      businessStatus: detail.businessStatus,
      googleMapsUri: detail.googleMapsUri,
      ...(detail.currentOpeningHoursJson
        ? { currentOpeningHours: detail.currentOpeningHoursJson }
        : {}),
      ...(detail.regularOpeningHoursJson
        ? { regularOpeningHours: detail.regularOpeningHoursJson }
        : {}),
      ...(detail.priceLevel ? { priceLevel: detail.priceLevel } : {}),
      ...(detail.priceRangeJson ? { priceRange: detail.priceRangeJson } : {}),
      ...(detail.rating === undefined ? {} : { rating: detail.rating }),
      ...(detail.userRatingCount === undefined ? {} : { userRatingCount: detail.userRatingCount }),
      fetchedAt: detail.fetchedAt,
    }),
  );
}

export async function enrichGooglePlacesCaptureDetails({
  apiKey,
  fieldMask = googlePlacesEnterpriseDetailsFieldMask,
  placeIds,
  fetchedAt = new Date().toISOString(),
  fetcher = fetch,
}: {
  apiKey: string;
  fieldMask?: string;
  placeIds: readonly string[];
  fetchedAt?: string;
  fetcher?: Fetcher;
}) {
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for Google Places enrichment.");
  }

  if (fieldMask.includes("*")) {
    throw new Error("Google Places enrichment field masks must be explicit.");
  }

  return Promise.all(
    [...new Set(placeIds)].map(async (placeId): Promise<GooglePlacesCaptureDetails> => {
      const response = await fetchWithProviderTimeout(
        fetcher,
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
        {
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": fieldMask,
          },
        },
      );
      const payload = await parseGooglePlacesDetailsResponse(response);
      return parseGooglePlacesCaptureDetails(payload, placeId, fetchedAt, fieldMask);
    }),
  );
}

export function createGooglePlacesDetailsSourceRecordId(placeId: string) {
  return `record_google_places_details_${slugPart(placeId)}`;
}

export function createGooglePlacesCandidateEntityId(placeId: string) {
  return `candidate_google_places_${placeId}`;
}

export function normalizeGooglePlacesDetailsPayload(details: GooglePlacesDetails) {
  return {
    placeId: details.placeId,
    resourceName: details.resourceName,
    displayName: details.displayName,
    formattedAddress: details.formattedAddress,
    location:
      details.latitude === undefined || details.longitude === undefined
        ? undefined
        : {
            latitude: details.latitude,
            longitude: details.longitude,
          },
    types: details.types,
    primaryType: details.primaryType,
    businessStatus: details.businessStatus,
    googleMapsUri: details.googleMapsUri,
    currentOpeningHours: details.currentOpeningHours,
    regularOpeningHours: details.regularOpeningHours,
    priceLevel: details.priceLevel,
    priceRange: details.priceRange,
    rating: details.rating,
    userRatingCount: details.userRatingCount,
    fieldMask: googlePlacesDetailsFieldMask,
    sku: "Places API Place Details Pro",
    storagePolicy:
      "Refreshable Google Places evidence. Store durable Place ID; do not publish copied Google listing content as a public directory.",
  };
}

export { googlePlacesDiscoverySourceProfileId };

async function parseGooglePlacesDetailsResponse(
  response: Response,
): Promise<GooglePlacesDetailsResponse> {
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    throw new Error("Google Places details response was not a JSON object.");
  }

  const parsed = payload as GooglePlacesDetailsResponse;
  if (!response.ok || parsed.error) {
    const status = parsed.error?.status ?? response.statusText;
    const message = parsed.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Google Places enrichment failed: ${status}: ${message}`);
  }

  return parsed;
}

function parseGooglePlacesCaptureDetails(
  payload: GooglePlacesDetailsResponse,
  requestedPlaceId: string,
  fetchedAt: string,
  fieldMask: string,
): GooglePlacesCaptureDetails {
  const placeId = payload.id ?? requestedPlaceId;
  const displayName = payload.displayName?.text;
  if (!displayName) {
    throw new Error(`Google Places details for ${requestedPlaceId} did not include displayName.`);
  }

  return {
    placeId,
    resourceName: payload.name ?? `places/${placeId}`,
    displayName,
    formattedAddress: payload.formattedAddress,
    latitude: payload.location?.latitude,
    longitude: payload.location?.longitude,
    displayNameJson: payload.displayName,
    shortFormattedAddress: payload.shortFormattedAddress,
    addressComponentsJson: payload.addressComponents,
    locationJson: payload.location,
    viewportJson: payload.viewport,
    types: payload.types ?? [],
    primaryType: payload.primaryType,
    businessStatus: payload.businessStatus,
    googleMapsUri: payload.googleMapsUri,
    websiteUri: payload.websiteUri,
    nationalPhoneNumber: payload.nationalPhoneNumber,
    internationalPhoneNumber: payload.internationalPhoneNumber,
    currentOpeningHoursJson: payload.currentOpeningHours,
    regularOpeningHoursJson: payload.regularOpeningHours,
    priceLevel: payload.priceLevel,
    priceRangeJson: payload.priceRange,
    rating: payload.rating,
    userRatingCount: payload.userRatingCount,
    paymentOptionsJson: payload.paymentOptions,
    parkingOptionsJson: payload.parkingOptions,
    amenitiesJson: buildAmenitiesJson(payload),
    attributionsJson: payload.attributions,
    reviews: payload.reviews ?? [],
    fieldMask,
    fetchedAt,
  };
}

function buildAmenitiesJson(payload: GooglePlacesDetailsResponse): Record<string, unknown> {
  return {
    allowsDogs: payload.allowsDogs,
    curbsidePickup: payload.curbsidePickup,
    delivery: payload.delivery,
    dineIn: payload.dineIn,
    goodForChildren: payload.goodForChildren,
    goodForGroups: payload.goodForGroups,
    goodForWatchingSports: payload.goodForWatchingSports,
    liveMusic: payload.liveMusic,
    outdoorSeating: payload.outdoorSeating,
    restroom: payload.restroom,
    servesBeer: payload.servesBeer,
    servesBreakfast: payload.servesBreakfast,
    servesBrunch: payload.servesBrunch,
    servesCocktails: payload.servesCocktails,
    servesCoffee: payload.servesCoffee,
    servesDessert: payload.servesDessert,
    servesDinner: payload.servesDinner,
    servesLunch: payload.servesLunch,
    servesVegetarianFood: payload.servesVegetarianFood,
    servesWine: payload.servesWine,
    takeout: payload.takeout,
  };
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
