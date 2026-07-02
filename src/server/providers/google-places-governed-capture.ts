import type {
  GooglePlacesChatContext,
  GooglePlacesChatPlace,
  GooglePlacesChatSearch,
} from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  createGooglePlaceSnapshotInput,
  type GooglePlaceDetailsInput,
  type GooglePlacesSourceRecordInput,
  type UpsertGooglePlaceDetailsInput,
} from "@/server/providers/google-places-store";

export function createGooglePlacesChatCaptureInput({
  context,
  place,
  resultIndex,
}: {
  context: GooglePlacesChatContext;
  place: GooglePlacesChatPlace;
  resultIndex: number;
}): UpsertGooglePlaceDetailsInput {
  const snapshot = createGooglePlaceSnapshotInput({
    placeId: place.placeId,
    requestKind: "chat_search",
    fieldMask: context.fieldMask,
    fetchedAt: context.fetchedAt,
    payloadJson: {
      search: {
        cacheKey: googlePlacesChatSearchCacheKey(context.search),
        label: context.search.label,
        textQuery: context.search.textQuery,
        includedType: context.search.includedType,
        center: context.search.center,
        radiusMeters: context.search.radiusMeters,
        pageSize: context.search.pageSize,
        resultIndex,
      },
      place: place.captureJson ?? {
        placeId: place.placeId,
        resourceName: place.resourceName,
        displayNameJson: { text: place.displayName },
        formattedAddress: place.formattedAddress,
        locationJson:
          place.latitude === undefined || place.longitude === undefined
            ? undefined
            : { latitude: place.latitude, longitude: place.longitude },
        typesJson: place.types,
        primaryType: place.primaryType,
        businessStatus: place.businessStatus,
        googleMapsUri: place.googleMapsUri,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
      },
    },
  });
  const sourceRecord: GooglePlacesSourceRecordInput = {
    id: `record_google_places_chat_${slugPart(place.placeId)}`,
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    providerEntityId: place.placeId,
    entityType: place.primaryType ?? place.types[0] ?? context.search.includedType ?? "place",
    name: place.displayName,
    normalizedPayload: {
      placeId: place.placeId,
      resourceName: place.resourceName,
      searchCacheKey: googlePlacesChatSearchCacheKey(context.search),
      searchLabel: context.search.label,
      textQuery: context.search.textQuery,
      fieldMask: context.fieldMask,
      storagePolicy: snapshot.storagePolicy,
    },
    sourceUrl: place.googleMapsUri,
    fetchedAt: context.fetchedAt,
    allowedUse: "citation_only",
  };
  const details: GooglePlaceDetailsInput = {
    displayNameJson: place.captureJson?.displayNameJson ?? { text: place.displayName },
    formattedAddress: place.formattedAddress,
    locationJson: place.captureJson?.locationJson,
    latitude: place.latitude,
    longitude: place.longitude,
    typesJson: place.types,
    primaryType: place.primaryType,
    businessStatus: place.businessStatus,
    googleMapsUri: place.googleMapsUri,
    websiteUri: place.websiteUri,
    internationalPhoneNumber: place.internationalPhoneNumber,
    openingHoursJson: place.currentOpeningHours ?? place.regularOpeningHours,
    priceLevel: place.priceLevel,
    priceRangeJson: place.priceRange,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    fetchedAt: context.fetchedAt,
    staleAt: snapshot.staleAt,
    retentionExpiresAt: snapshot.retentionExpiresAt ?? snapshot.staleAt,
  };

  return {
    place: {
      placeId: place.placeId,
      resourceName: place.resourceName,
    },
    sourceRecord,
    snapshot,
    details,
  };
}

export function googlePlacesChatSearchCacheKey(search: GooglePlacesChatSearch) {
  return [
    normalizeCachePart(search.textQuery),
    normalizeCachePart(search.includedType ?? "any"),
    search.openNow ? "open_now" : "any_hours",
    coordinatePart(search.center.latitude),
    coordinatePart(search.center.longitude),
    search.radiusMeters,
    search.pageSize,
  ].join("|");
}

function normalizeCachePart(value: string) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function coordinatePart(value: number) {
  return value.toFixed(4);
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
