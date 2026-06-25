import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import { googlePlacesDetailsFieldMask } from "@/server/providers/google-places-policy";

export { googlePlacesDetailsFieldMask };

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
  fetchedAt: string;
};

type GooglePlacesDetailsResponse = {
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
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for Google Places enrichment.");
  }

  const details = await Promise.all(
    [...new Set(placeIds)].map(async (placeId): Promise<GooglePlacesDetails> => {
      const response = await fetcher(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
        {
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": googlePlacesDetailsFieldMask,
          },
        },
      );
      const payload = await parseGooglePlacesDetailsResponse(response);
      return parseGooglePlacesDetails(payload, placeId, fetchedAt);
    }),
  );

  return details;
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

function parseGooglePlacesDetails(
  payload: GooglePlacesDetailsResponse,
  requestedPlaceId: string,
  fetchedAt: string,
): GooglePlacesDetails {
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
    types: payload.types ?? [],
    primaryType: payload.primaryType,
    businessStatus: payload.businessStatus,
    googleMapsUri: payload.googleMapsUri,
    fetchedAt,
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
