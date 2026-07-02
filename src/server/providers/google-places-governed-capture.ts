import type { AllowedUseState } from "@/server/audit/enums";
import {
  createGovernedEvidence,
  createGovernedFact,
  normalizeSourceRecord,
} from "@/server/facts/fact-graph";
import type { GovernedEvidence, GovernedFact, NormalizedSourceRecord } from "@/server/facts/types";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import type {
  GooglePlacesChatContext,
  GooglePlacesChatPlace,
  GooglePlacesChatSearch,
} from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import type { GooglePlacesCaptureDetails } from "@/server/providers/google-places-enrichment";
import {
  buildGooglePlacesAttributionMetadata,
  type GooglePlacesRequestKind,
  type GooglePlacesRequestPolicy,
  type GooglePlacesReuseState,
  getGooglePlacesReuseState,
  googlePlacesRequestPolicies,
  requireGooglePlacesRequestPolicy,
} from "@/server/providers/google-places-policy";
import {
  createGooglePlaceFactEvidenceInputs,
  type GooglePlaceDetailsInput,
  type GooglePlaceGovernedFactEvidenceInput,
  type GooglePlaceSnapshotInput,
  type GooglePlacesSourceRecordInput,
  type UpsertGooglePlaceDetailsInput,
} from "@/server/providers/google-places-store";
import { SourcePolicyError, type SourceRegistry } from "@/server/providers/source-registry";

type JsonObject = Record<string, unknown>;

type GooglePlacesPolicyRegistry = Partial<
  Record<GooglePlacesRequestKind, Partial<GooglePlacesRequestPolicy>>
>;

export type GooglePlacesGovernedCapturePolicy = {
  requestKind: GooglePlacesRequestKind;
  sourceProfileId: string;
  sourceName: string;
  allowedUse: AllowedUseState;
  fieldMask: string;
  fetchedAt: string;
  staleAt: string;
  retentionExpiresAt: string;
  storagePolicy: GooglePlaceSnapshotInput["storagePolicy"];
  requiresGoogleAttribution: boolean;
  attributionJson: JsonObject;
  reuseState: GooglePlacesReuseState;
  auditUseAllowed: boolean;
  canCitePublicly: boolean;
  canExposeToAgents: boolean;
  confidenceLabel: GovernedFact["confidenceLabel"];
  rawEvidenceAllowed: boolean;
  publicRepublishAllowed: boolean;
  sourceAuthority: number;
};

export type GooglePlacesGovernedCaptureResult = UpsertGooglePlaceDetailsInput & {
  governedPolicy: GooglePlacesGovernedCapturePolicy;
  governedSourceRecord: NormalizedSourceRecord;
  governedFacts: GovernedFact[];
  governedEvidence: GovernedEvidence[];
};

type GooglePlacesGovernedCaptureOptions = {
  now?: string;
  policies?: GooglePlacesPolicyRegistry;
  registry?: SourceRegistry;
  sourceProfileId?: string;
};

export function createGooglePlacesChatCaptureInput({
  context,
  now,
  place,
  policies,
  registry,
  resultIndex,
  sourceProfileId,
}: {
  context: GooglePlacesChatContext;
  place: GooglePlacesChatPlace;
  resultIndex: number;
} & GooglePlacesGovernedCaptureOptions): GooglePlacesGovernedCaptureResult {
  const captureRegistry = registry ?? createDefaultSourceRegistry();
  const policy = resolveGooglePlacesGovernedCapturePolicy({
    fetchedAt: context.fetchedAt,
    fieldMask: context.fieldMask,
    now,
    placePayload: place.captureJson,
    policies,
    registry: captureRegistry,
    requestKind: "chat_search",
    sourceProfileId,
  });
  const placePayload = place.captureJson ?? {
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
  };
  const snapshot = createGovernedGooglePlaceSnapshotInput({
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
      place: placePayload,
    },
    placeId: place.placeId,
    policy,
  });
  const sourceRecord: GooglePlacesSourceRecordInput = {
    id: `record_google_places_chat_${slugPart(place.placeId).toLowerCase()}`,
    sourceProfileId: policy.sourceProfileId,
    providerEntityId: place.placeId,
    entityType: place.primaryType ?? place.types[0] ?? context.search.includedType ?? "place",
    name: place.displayName,
    normalizedPayload: {
      placeId: place.placeId,
      resourceName: place.resourceName,
      searchCacheKey: googlePlacesChatSearchCacheKey(context.search),
      searchLabel: context.search.label,
      textQuery: context.search.textQuery,
      fieldMask: policy.fieldMask,
      requestKind: policy.requestKind,
      storagePolicy: policy.storagePolicy,
      staleAt: policy.staleAt,
      retentionExpiresAt: policy.retentionExpiresAt,
      publicRepublishAllowed: policy.publicRepublishAllowed,
      auditUseAllowed: policy.auditUseAllowed,
      rawEvidenceAllowed: policy.rawEvidenceAllowed,
      requiresGoogleAttribution: policy.requiresGoogleAttribution,
    },
    sourceUrl: place.googleMapsUri,
    fetchedAt: context.fetchedAt,
    allowedUse: policy.allowedUse,
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
    staleAt: policy.staleAt,
    retentionExpiresAt: policy.retentionExpiresAt,
  };

  return createGovernedCaptureResult({
    details,
    place: {
      placeId: place.placeId,
      resourceName: place.resourceName,
    },
    policy,
    registry: captureRegistry,
    snapshot,
    sourceRecord,
  });
}

export function createGooglePlacesDetailsCaptureInput({
  details,
  now,
  policies,
  registry,
  requestKind,
  sourceProfileId,
}: {
  details: GooglePlacesCaptureDetails;
  requestKind: GooglePlacesRequestKind;
} & GooglePlacesGovernedCaptureOptions): GooglePlacesGovernedCaptureResult {
  const captureRegistry = registry ?? createDefaultSourceRegistry();
  const policy = resolveGooglePlacesGovernedCapturePolicy({
    fetchedAt: details.fetchedAt,
    fieldMask: details.fieldMask,
    now,
    placePayload: googlePlacesDetailsPayload(details),
    policies,
    registry: captureRegistry,
    requestKind,
    sourceProfileId,
  });
  const sourceRecord: GooglePlacesSourceRecordInput = {
    id: `record_google_places_details_${slugPart(details.placeId)}`,
    sourceProfileId: policy.sourceProfileId,
    providerEntityId: details.placeId,
    entityType: details.primaryType ?? details.types[0] ?? "place",
    name: details.displayName,
    normalizedPayload: {
      ...googlePlacesDetailsPayload(details),
      fieldMask: policy.fieldMask,
      requestKind: policy.requestKind,
      storagePolicy: policy.storagePolicy,
      staleAt: policy.staleAt,
      retentionExpiresAt: policy.retentionExpiresAt,
      publicRepublishAllowed: policy.publicRepublishAllowed,
      auditUseAllowed: policy.auditUseAllowed,
      rawEvidenceAllowed: policy.rawEvidenceAllowed,
      requiresGoogleAttribution: policy.requiresGoogleAttribution,
    },
    sourceUrl: details.googleMapsUri,
    fetchedAt: details.fetchedAt,
    allowedUse: policy.allowedUse,
  };
  const snapshot = createGovernedGooglePlaceSnapshotInput({
    fetchedAt: details.fetchedAt,
    payloadJson: googlePlacesDetailsPayload(details),
    placeId: details.placeId,
    policy,
  });

  return createGovernedCaptureResult({
    details: {
      displayNameJson: details.displayNameJson ?? { text: details.displayName },
      formattedAddress: details.formattedAddress,
      shortFormattedAddress: details.shortFormattedAddress,
      addressComponentsJson: details.addressComponentsJson,
      locationJson: details.locationJson,
      latitude: details.latitude,
      longitude: details.longitude,
      viewportJson: details.viewportJson,
      typesJson: details.types,
      primaryType: details.primaryType,
      businessStatus: details.businessStatus,
      googleMapsUri: details.googleMapsUri,
      websiteUri: details.websiteUri,
      nationalPhoneNumber: details.nationalPhoneNumber,
      internationalPhoneNumber: details.internationalPhoneNumber,
      openingHoursJson: details.currentOpeningHoursJson ?? details.regularOpeningHoursJson,
      priceLevel: details.priceLevel,
      priceRangeJson: details.priceRangeJson,
      rating: details.rating,
      userRatingCount: details.userRatingCount,
      paymentOptionsJson: details.paymentOptionsJson,
      parkingOptionsJson: details.parkingOptionsJson,
      amenitiesJson: details.amenitiesJson,
      attributionsJson: details.attributionsJson,
      fetchedAt: details.fetchedAt,
      staleAt: policy.staleAt,
      retentionExpiresAt: policy.retentionExpiresAt,
    },
    place: {
      placeId: details.placeId,
      resourceName: details.resourceName,
    },
    policy,
    registry: captureRegistry,
    snapshot,
    sourceRecord,
  });
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

function resolveGooglePlacesGovernedCapturePolicy({
  fetchedAt,
  fieldMask,
  now = fetchedAt,
  placePayload,
  policies,
  registry = createDefaultSourceRegistry(),
  requestKind,
  sourceProfileId = googlePlacesDiscoverySourceProfileId,
}: {
  fetchedAt: string;
  fieldMask?: string;
  now?: string;
  placePayload?: JsonObject;
  policies?: GooglePlacesPolicyRegistry;
  registry?: SourceRegistry;
  requestKind: string;
  sourceProfileId?: string;
}): GooglePlacesGovernedCapturePolicy {
  const profile = registry.require(sourceProfileId);
  if (!profile.allowedUse) {
    throw new SourcePolicyError(`Source profile ${sourceProfileId} is missing allowed-use policy.`);
  }
  const decision = registry.assertCanEnterFactGraph(sourceProfileId);
  if (!decision.canCitePublicly) {
    throw new SourcePolicyError(
      `Source profile ${sourceProfileId} cannot cite Google Places observations publicly.`,
    );
  }
  const requestPolicy = requireGooglePlacesRequestPolicy({
    fieldMask,
    policies: policies ?? googlePlacesRequestPolicies,
    requestKind,
  });
  const fetchedAtDate = new Date(fetchedAt);
  const staleAt = addDays(fetchedAtDate, requestPolicy.freshnessDays).toISOString();
  const retentionExpiresAt = addDays(fetchedAtDate, requestPolicy.retentionDays).toISOString();
  const attributionJson = buildGooglePlacesAttributionMetadata({
    fetchedAt,
    fieldMask: requestPolicy.fieldMask,
    place: placePayload,
  });
  if (attributionJson.requiresGoogleAttribution !== requestPolicy.requiresGoogleAttribution) {
    throw new SourcePolicyError(
      `Google Places ${requestPolicy.requestKind} attribution metadata does not match policy.`,
    );
  }
  const reuseState = getGooglePlacesReuseState({
    now,
    retentionExpiresAt,
    staleAt,
    storagePolicy: requestPolicy.storagePolicy,
  });

  return {
    requestKind: requestPolicy.requestKind,
    sourceProfileId,
    sourceName: profile.sourceName,
    allowedUse: profile.allowedUse,
    fieldMask: requestPolicy.fieldMask,
    fetchedAt,
    staleAt,
    retentionExpiresAt,
    storagePolicy: requestPolicy.storagePolicy,
    requiresGoogleAttribution: requestPolicy.requiresGoogleAttribution,
    attributionJson,
    reuseState,
    auditUseAllowed: decision.canUseInPaidAudit,
    canCitePublicly: decision.canCitePublicly,
    canExposeToAgents: decision.canExposeToAgents,
    confidenceLabel: decision.confidenceFloor,
    rawEvidenceAllowed: decision.canStoreRaw,
    publicRepublishAllowed: decision.publicRepublishAllowed,
    sourceAuthority: profile.authorityLevel,
  };
}

function createGovernedCaptureResult({
  details,
  place,
  policy,
  registry,
  snapshot,
  sourceRecord,
}: Pick<UpsertGooglePlaceDetailsInput, "details" | "place" | "snapshot" | "sourceRecord"> & {
  policy: GooglePlacesGovernedCapturePolicy;
  registry: SourceRegistry;
}): GooglePlacesGovernedCaptureResult {
  const governedSourceRecord = normalizeSourceRecord(registry, {
    ...sourceRecord,
    normalizedPayload: {
      ...sourceRecord.normalizedPayload,
      governedPolicy: policy,
    },
  });
  const governedFactEvidence =
    policy.reuseState === "fresh" && policy.storagePolicy !== "google_no_store"
      ? createGovernedGooglePlaceFactEvidence({
          details,
          governedSourceRecord,
          place,
          policy,
          registry,
        })
      : [];

  return {
    place,
    sourceRecord,
    snapshot,
    details,
    governedFactEvidence,
    governedPolicy: policy,
    governedSourceRecord,
    governedFacts: governedFactEvidence.map((record) => record.fact),
    governedEvidence: governedFactEvidence.map((record) => record.evidence),
  };
}

function createGovernedGooglePlaceFactEvidence({
  details,
  governedSourceRecord,
  place,
  policy,
  registry,
}: {
  place: UpsertGooglePlaceDetailsInput["place"];
  governedSourceRecord: NormalizedSourceRecord;
  details: GooglePlaceDetailsInput;
  policy: GooglePlacesGovernedCapturePolicy;
  registry: SourceRegistry;
}): GooglePlaceGovernedFactEvidenceInput[] {
  const factInputs = createGooglePlaceFactEvidenceInputs({
    details,
    fieldMask: policy.fieldMask,
    governance: {
      auditUseAllowed: policy.auditUseAllowed,
      confidenceLabel: policy.confidenceLabel,
      publicRepublishAllowed: policy.publicRepublishAllowed,
      rawEvidenceAllowed: policy.rawEvidenceAllowed,
      sourceAuthority: policy.sourceAuthority,
      sourceType: governedSourceRecord.sourceType,
    },
    place,
    sourceRecord: {
      id: governedSourceRecord.id,
      sourceProfileId: governedSourceRecord.sourceProfileId,
      providerEntityId: governedSourceRecord.providerEntityId ?? place.placeId,
      entityType: governedSourceRecord.entityType,
      name: governedSourceRecord.name,
      normalizedPayload: governedSourceRecord.normalizedPayload,
      sourceUrl: governedSourceRecord.sourceUrl,
      fetchedAt: governedSourceRecord.fetchedAt,
      allowedUse: governedSourceRecord.allowedUse,
    },
  });

  return factInputs.map(({ evidence, fact }) => {
    const governedFact = createGovernedFact(registry, governedSourceRecord, fact);
    return {
      fact: governedFact,
      evidence: createGovernedEvidence(registry, governedFact, evidence),
    };
  });
}

function createGovernedGooglePlaceSnapshotInput({
  fetchedAt,
  payloadJson,
  placeId,
  policy,
}: {
  placeId: string;
  policy: GooglePlacesGovernedCapturePolicy;
  fetchedAt: string;
  payloadJson?: JsonObject;
}): GooglePlaceSnapshotInput {
  return {
    id: googleSnapshotId(placeId, policy.requestKind, policy.fieldMask, fetchedAt),
    requestKind: policy.requestKind,
    fieldMask: policy.fieldMask,
    payloadJson,
    payloadHash: hashStableJson(payloadJson ?? {}),
    fetchedAt,
    staleAt: policy.staleAt,
    retentionExpiresAt: policy.retentionExpiresAt,
    storagePolicy: policy.storagePolicy,
    attributionJson: policy.attributionJson,
  };
}

function googlePlacesDetailsPayload(details: GooglePlacesCaptureDetails): JsonObject {
  return {
    placeId: details.placeId,
    resourceName: details.resourceName,
    displayName: details.displayName,
    displayNameJson: details.displayNameJson,
    formattedAddress: details.formattedAddress,
    shortFormattedAddress: details.shortFormattedAddress,
    addressComponentsJson: details.addressComponentsJson,
    locationJson: details.locationJson,
    typesJson: details.types,
    primaryType: details.primaryType,
    businessStatus: details.businessStatus,
    googleMapsUri: details.googleMapsUri,
    rating: details.rating,
    userRatingCount: details.userRatingCount,
    attributions: details.attributionsJson,
  };
}

function normalizeCachePart(value: string) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function coordinatePart(value: number) {
  return value.toFixed(4);
}

function googleSnapshotId(
  placeId: string,
  requestKind: GooglePlacesRequestKind,
  fieldMask: string,
  fetchedAt: string,
) {
  return `snapshot_google_places_${slugPart(placeId)}_${slugPart(requestKind)}_${hashStableJson({
    fetchedAt,
    fieldMask,
  })}`;
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hashStableJson(value: unknown) {
  const json = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  let hash = 0;
  for (let index = 0; index < json.length; index += 1) {
    hash = (hash * 31 + json.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}
