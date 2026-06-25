const daysToMs = 24 * 60 * 60 * 1000;

export const googlePlacesFieldMaskGroups = {
  chatSearch: [
    "places.id",
    "places.name",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.types",
    "places.primaryType",
    "places.businessStatus",
    "places.googleMapsUri",
    "places.rating",
    "places.userRatingCount",
    "places.currentOpeningHours",
    "places.regularOpeningHours",
    "places.priceLevel",
    "places.priceRange",
    "places.websiteUri",
    "places.internationalPhoneNumber",
  ],
  detailsIdentityContact: [
    "id",
    "name",
    "displayName",
    "formattedAddress",
    "location",
    "types",
    "primaryType",
    "businessStatus",
    "googleMapsUri",
  ],
  enterprise: [
    "rating",
    "userRatingCount",
    "priceLevel",
    "priceRange",
    "currentOpeningHours",
    "regularOpeningHours",
    "websiteUri",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
  ],
  atmosphere: [
    "reviews",
    "reviewSummary",
    "paymentOptions",
    "parkingOptions",
    "allowsDogs",
    "curbsidePickup",
    "delivery",
    "dineIn",
    "goodForChildren",
    "goodForGroups",
    "goodForWatchingSports",
    "liveMusic",
    "outdoorSeating",
    "restroom",
    "servesBeer",
    "servesBreakfast",
    "servesBrunch",
    "servesCocktails",
    "servesCoffee",
    "servesDessert",
    "servesDinner",
    "servesLunch",
    "servesVegetarianFood",
    "servesWine",
    "takeout",
  ],
} as const;

export type GooglePlacesRequestKind =
  | "chat_search"
  | "details_identity_contact"
  | "details_enterprise"
  | "details_atmosphere_reviews";

export type GooglePlacesGovernedField =
  | "place_id"
  | "business_status"
  | "rating"
  | "user_rating_count"
  | "reviews"
  | "price_level"
  | "price_range"
  | "opening_hours"
  | "website"
  | "phone"
  | "address"
  | "lat_lng";

export type GooglePlacesStoragePolicy =
  | "durable_identifier"
  | "google_refreshable_cache"
  | "google_attribution_required_cache"
  | "google_no_store";

export type GooglePlacesReuseState = "fresh" | "stale" | "expired" | "not_legally_reusable";

export const googlePlacesFieldFreshnessDays = {
  place_id: "indefinite",
  business_status: 7,
  rating: 7,
  user_rating_count: 7,
  reviews: 7,
  price_level: 14,
  price_range: 14,
  opening_hours: 5,
  website: 30,
  phone: 30,
  address: 30,
  lat_lng: 30,
} as const satisfies Record<GooglePlacesGovernedField, number | "indefinite">;

function buildGooglePlacesFieldMask(fields: readonly string[]) {
  if (fields.some((field) => field === "*" || field.includes("*"))) {
    throw new Error("Google Places field masks must be explicit and cannot include wildcards.");
  }

  return [...fields].join(",");
}

export const googlePlacesChatSearchFieldMask = buildGooglePlacesFieldMask(
  googlePlacesFieldMaskGroups.chatSearch,
);

export const googlePlacesDetailsFieldMask = buildGooglePlacesFieldMask(
  googlePlacesFieldMaskGroups.detailsIdentityContact,
);

export const googlePlacesEnterpriseDetailsFieldMask = buildGooglePlacesFieldMask([
  ...googlePlacesFieldMaskGroups.detailsIdentityContact,
  ...googlePlacesFieldMaskGroups.enterprise,
]);

export const googlePlacesAtmosphereDetailsFieldMask = buildGooglePlacesFieldMask([
  ...googlePlacesFieldMaskGroups.detailsIdentityContact,
  ...googlePlacesFieldMaskGroups.enterprise,
  ...googlePlacesFieldMaskGroups.atmosphere,
]);

export const googlePlacesRequestPolicies: Record<
  GooglePlacesRequestKind,
  {
    fieldMask: string;
    freshnessDays: number;
    retentionDays: number;
    storagePolicy: GooglePlacesStoragePolicy;
    requiresGoogleAttribution: boolean;
  }
> = {
  chat_search: {
    fieldMask: googlePlacesChatSearchFieldMask,
    freshnessDays: googlePlacesFieldFreshnessDays.opening_hours,
    retentionDays: 30,
    storagePolicy: "google_attribution_required_cache",
    requiresGoogleAttribution: true,
  },
  details_identity_contact: {
    fieldMask: googlePlacesDetailsFieldMask,
    freshnessDays: googlePlacesFieldFreshnessDays.address,
    retentionDays: 30,
    storagePolicy: "google_attribution_required_cache",
    requiresGoogleAttribution: true,
  },
  details_enterprise: {
    fieldMask: googlePlacesEnterpriseDetailsFieldMask,
    freshnessDays: googlePlacesFieldFreshnessDays.rating,
    retentionDays: 30,
    storagePolicy: "google_attribution_required_cache",
    requiresGoogleAttribution: true,
  },
  details_atmosphere_reviews: {
    fieldMask: googlePlacesAtmosphereDetailsFieldMask,
    freshnessDays: googlePlacesFieldFreshnessDays.reviews,
    retentionDays: 7,
    storagePolicy: "google_attribution_required_cache",
    requiresGoogleAttribution: true,
  },
};

export function computeGooglePlacesFieldStaleAt({
  fetchedAt,
  field,
}: {
  fetchedAt: Date | string;
  field: GooglePlacesGovernedField;
}) {
  const freshnessDays = googlePlacesFieldFreshnessDays[field];
  if (freshnessDays === "indefinite") {
    return null;
  }

  return addDays(fetchedAt, freshnessDays);
}

export function computeGooglePlacesRequestWindows({
  fetchedAt,
  requestKind,
}: {
  fetchedAt: Date | string;
  requestKind: GooglePlacesRequestKind;
}) {
  const policy = googlePlacesRequestPolicies[requestKind];

  return {
    fetchedAt: toDate(fetchedAt),
    staleAt: addDays(fetchedAt, policy.freshnessDays),
    retentionExpiresAt: addDays(fetchedAt, policy.retentionDays),
    storagePolicy: policy.storagePolicy,
    requiresGoogleAttribution: policy.requiresGoogleAttribution,
  };
}

export function getGooglePlacesReuseState({
  now,
  retentionExpiresAt,
  staleAt,
  storagePolicy,
}: {
  now: Date | string;
  staleAt: Date | string | null;
  retentionExpiresAt: Date | string | null;
  storagePolicy: GooglePlacesStoragePolicy;
}): GooglePlacesReuseState {
  if (storagePolicy === "google_no_store") {
    return "not_legally_reusable";
  }

  const nowDate = toDate(now);
  if (retentionExpiresAt && toDate(retentionExpiresAt) <= nowDate) {
    return "expired";
  }

  if (staleAt && toDate(staleAt) <= nowDate) {
    return "stale";
  }

  return "fresh";
}

export function buildGooglePlacesAttributionMetadata({
  fetchedAt,
  fieldMask,
  place,
}: {
  fetchedAt: Date | string;
  fieldMask: string;
  place?: Record<string, unknown>;
}) {
  const attributions =
    readUnknownArray(place, "attributions") ?? readUnknownArray(place, "htmlAttributions");
  const googleMapsUri = readString(place, "googleMapsUri");

  return {
    sourceName: "Google Places",
    requiresGoogleAttribution: true,
    fieldMask,
    fetchedAt: toDate(fetchedAt).toISOString(),
    ...(googleMapsUri ? { googleMapsUri } : {}),
    ...(attributions ? { attributions } : {}),
  };
}

function addDays(value: Date | string, days: number) {
  return new Date(toDate(value).getTime() + days * daysToMs);
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function readString(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function readUnknownArray(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
}
