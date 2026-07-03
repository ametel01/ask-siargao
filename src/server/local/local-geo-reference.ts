import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

export type LocalGeoCoordinates = {
  latitude: number;
  longitude: number;
};

export type LocalGeoReferenceAdapterIssue = {
  adapterId: string;
  code:
    | "adapter_missing"
    | "anchor_block_missing"
    | "malformed_anchor_json"
    | "malformed_anchor_records";
};

export type LocalGeoReferenceLoadResult<RecordType> = {
  records: RecordType[];
  issues: LocalGeoReferenceAdapterIssue[];
};

export type SurfSpotSkillLevel = "beginner" | "intermediate" | "advanced" | "any";

export type SurfSpotAccess = "shore" | "paddle" | "boat" | "local";

export type LocalGeoSurfSpotRecord = {
  id: string;
  name: string;
  aliases: readonly string[];
  area: string;
  skillLevels: readonly Exclude<SurfSpotSkillLevel, "any">[];
  access: SurfSpotAccess;
  latitude: number;
  longitude: number;
  caveats: readonly string[];
};

export type RankedSurfSpot = Omit<LocalGeoSurfSpotRecord, "latitude" | "longitude"> & {
  distanceKm: number;
  distanceLabel: string;
  fitReasons: readonly string[];
};

export type RankSurfSpotsNearbyInput = {
  center: LocalGeoCoordinates;
  spots: readonly LocalGeoSurfSpotRecord[];
  skillLevel?: SurfSpotSkillLevel;
  maxResults?: number;
  includeBoatAccess?: boolean;
};

export type SiargaoBeachSurface = "sand" | "mixed" | "rocky";

export type LocalGeoBeachRecord = {
  name: string;
  area: string;
  areaKeywords: readonly string[];
  location: LocalGeoCoordinates;
  distanceFromGeneralLunaMinutes: { min: number; max: number };
  surface: SiargaoBeachSurface;
  swimmingFit: string;
  sunsetFit: string;
  surfFit: string;
  rainFit: string;
  tideNotes: string;
  confidence: "high" | "medium" | "low";
  sourceNotes: string;
};

export type LocalGeoOriginAnchor = {
  label: string;
  aliases: readonly string[];
  latitude: number;
  longitude: number;
};

export type BeachRecommendationRequest = {
  originLabel?: "Cloud 9" | "General Luna" | "Siargao Island";
  maxRideMinutes?: number;
  sandOnly?: boolean;
  avoidRocky?: boolean;
  swimming?: boolean;
  sunset?: boolean;
  conciseFollowUp?: boolean;
  transportMode?: "walk" | "scooter" | "tricycle" | "van";
  withKids?: boolean;
  durableConstraints?: string[];
};

export type LocalGuideSearchFilters = {
  beachName?: string;
  excludedBeachNames?: string[];
  beachSurface?: SiargaoBeachSurface | "any";
  originArea?: string;
  swimming?: boolean;
  sunset?: boolean;
  rainFit?: boolean;
  maxRideMinutes?: number;
  transportMode?: "walk" | "scooter" | "tricycle" | "van";
  withKids?: boolean;
};

export type LocalGuideCandidate = {
  name: string;
  area: string;
  rideTimeFromGeneralLunaMinutes: { min: number; max: number };
  surface: SiargaoBeachSurface;
  confidence: LocalGeoBeachRecord["confidence"];
  bestFor: string;
  fitReasons: string[];
  caveats: string[];
  sourceNotes: string;
};

export type LocalGuideExcludedCandidate = {
  name: string;
  reason: string;
};

export type LocalGuideSearchResult = {
  query: string;
  filters: LocalGuideSearchFilters;
  candidates: LocalGuideCandidate[];
  excluded: LocalGuideExcludedCandidate[];
  caveats: string[];
  sourceSummary: AnswerSourceSummary;
};

const maxSurfSpotResults = 10;

export function loadStaticLocalGeoReferences<RecordType>({
  adapterId,
  records,
  normalizeRecord,
}: {
  adapterId: string;
  records: readonly unknown[] | undefined;
  normalizeRecord: (value: unknown) => RecordType | undefined;
}): LocalGeoReferenceLoadResult<RecordType> {
  if (!records) {
    return {
      records: [],
      issues: [{ adapterId, code: "adapter_missing" }],
    };
  }

  const normalizedRecords = records.flatMap((value) => {
    const record = normalizeRecord(value);
    return record ? [record] : [];
  });
  return {
    records: normalizedRecords,
    issues:
      normalizedRecords.length === records.length
        ? []
        : [{ adapterId, code: "malformed_anchor_records" }],
  };
}

function loadMemoryLocalGeoReferences<RecordType>({
  adapterId,
  blockName,
  markdown,
  normalizeRecord,
}: {
  adapterId: string;
  blockName: string;
  markdown: string | undefined;
  normalizeRecord: (value: unknown) => RecordType | undefined;
}): LocalGeoReferenceLoadResult<RecordType> {
  if (!markdown) {
    return {
      records: [],
      issues: [{ adapterId, code: "adapter_missing" }],
    };
  }

  const block = fencedJsonBlock(markdown, blockName);
  if (!block) {
    return {
      records: [],
      issues: [{ adapterId, code: "anchor_block_missing" }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return {
      records: [],
      issues: [{ adapterId, code: "malformed_anchor_json" }],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      records: [],
      issues: [{ adapterId, code: "malformed_anchor_records" }],
    };
  }

  return loadStaticLocalGeoReferences({
    adapterId,
    records: parsed,
    normalizeRecord,
  });
}

export function loadSurfSpotGeoReferencesFromMarkdown(
  markdown: string | undefined,
): LocalGeoReferenceLoadResult<LocalGeoSurfSpotRecord> {
  return loadMemoryLocalGeoReferences({
    adapterId: "agent-memory:SURF.md",
    blockName: "surf_spot_distance_anchors",
    markdown,
    normalizeRecord: normalizeLocalGeoSurfSpotRecord,
  });
}

function normalizeLocalGeoSurfSpotRecord(value: unknown): LocalGeoSurfSpotRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readString(value.id);
  const name = readString(value.name);
  const area = readString(value.area);
  const access = readAccess(value.access);
  const latitude = readNumber(value.latitude);
  const longitude = readNumber(value.longitude);
  const skillLevels = readSkillLevels(value.skillLevels);
  if (
    !id ||
    !name ||
    !area ||
    !access ||
    latitude === undefined ||
    longitude === undefined ||
    skillLevels.length === 0
  ) {
    return undefined;
  }

  return {
    id,
    name,
    aliases: readStringArray(value.aliases),
    area,
    skillLevels,
    access,
    latitude,
    longitude,
    caveats: readStringArray(value.caveats),
  };
}

export function normalizeLocalGeoBeachRecord(value: unknown): LocalGeoBeachRecord | undefined {
  if (!isRecord(value) || !isRecord(value.location)) {
    return undefined;
  }
  const name = readString(value.name);
  const area = readString(value.area);
  const latitude = readNumber(value.location.latitude);
  const longitude = readNumber(value.location.longitude);
  const rideTime = readRideTime(value.distanceFromGeneralLunaMinutes);
  const surface = readBeachSurface(value.surface);
  const swimmingFit = readString(value.swimmingFit);
  const sunsetFit = readString(value.sunsetFit);
  const surfFit = readString(value.surfFit);
  const rainFit = readString(value.rainFit);
  const tideNotes = readString(value.tideNotes);
  const confidence = readConfidence(value.confidence);
  const sourceNotes = readString(value.sourceNotes);
  if (
    !name ||
    !area ||
    latitude === undefined ||
    longitude === undefined ||
    !rideTime ||
    !surface ||
    !swimmingFit ||
    !sunsetFit ||
    !surfFit ||
    !rainFit ||
    !tideNotes ||
    !confidence ||
    !sourceNotes
  ) {
    return undefined;
  }

  return {
    name,
    area,
    areaKeywords: readStringArray(value.areaKeywords),
    location: { latitude, longitude },
    distanceFromGeneralLunaMinutes: rideTime,
    surface,
    swimmingFit,
    sunsetFit,
    surfFit,
    rainFit,
    tideNotes,
    confidence,
    sourceNotes,
  };
}

export function normalizeLocalGeoOriginAnchor(value: unknown): LocalGeoOriginAnchor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const label = readString(value.label);
  const latitude = readNumber(value.latitude);
  const longitude = readNumber(value.longitude);
  if (!label || latitude === undefined || longitude === undefined) {
    return undefined;
  }
  return {
    label,
    aliases: readStringArray(value.aliases),
    latitude,
    longitude,
  };
}

export function rankSurfSpotReferences(input: RankSurfSpotsNearbyInput): RankedSurfSpot[] {
  const skillLevel = input.skillLevel ?? "any";
  const maxResults = normalizeMaxResults(input.maxResults);
  const rankedSpots: RankedSurfSpot[] = [];
  for (const spot of input.spots) {
    if (input.includeBoatAccess === false && spot.access === "boat") {
      continue;
    }
    if (!surfSpotSupportsSkillLevel(spot, skillLevel)) {
      continue;
    }
    rankedSpots.push(publicRankedSurfSpot(spot, input.center, skillLevel));
  }
  return rankedSpots
    .sort(
      (left, right) => left.distanceKm - right.distanceKm || left.name.localeCompare(right.name),
    )
    .slice(0, maxResults);
}

export function searchLocalGeoBeachGuide({
  beachRecords,
  filters = {},
  originAnchors,
  query,
  sourceSummary,
}: {
  query: string;
  filters?: LocalGuideSearchFilters;
  beachRecords: readonly LocalGeoBeachRecord[];
  originAnchors: readonly LocalGeoOriginAnchor[];
  sourceSummary: AnswerSourceSummary;
}): LocalGuideSearchResult {
  const normalizedFilters = normalizeLocalGuideFilters(query, filters, beachRecords, originAnchors);
  const maxRideMinutes = normalizedFilters.maxRideMinutes ?? 45;
  const selectedSurface = normalizedFilters.beachSurface ?? "any";
  const requestedBeachName = normalizedFilters.beachName;
  const excludedBeachNames = normalizedFilters.excludedBeachNames ?? [];
  const originAnchor = localGuideOriginAnchor(normalizedFilters.originArea, originAnchors);
  const usesGeneralLunaRideFilter = shouldUseGeneralLunaRideFilter(normalizedFilters.originArea);
  const excluded: LocalGuideExcludedCandidate[] = [];
  const candidates = beachRecords
    .filter((beach) => {
      const explicitlyExcluded = excludedBeachNames.some((excludedName) =>
        localGeoNameMatches(beach.name, excludedName),
      );
      const nameFits = localGeoNameMatches(beach.name, requestedBeachName);
      const rideTimeFits = localGuideRideTimeFits({
        beach,
        maxRideMinutes,
        originAnchor,
        usesGeneralLunaRideFilter,
      });
      const surfaceFits = selectedSurface === "any" || beach.surface === selectedSurface;
      if (explicitlyExcluded) {
        excluded.push({
          name: beach.name,
          reason: "explicitly excluded by the query",
        });
        return false;
      }
      if (nameFits) {
        return true;
      }
      if (!rideTimeFits) {
        excluded.push({
          name: beach.name,
          reason: localGuideRideTimeExclusionReason({
            beach,
            maxRideMinutes,
            originAnchor,
            usesGeneralLunaRideFilter,
          }),
        });
      } else if (!surfaceFits) {
        excluded.push({
          name: beach.name,
          reason: `${beach.surface} surface does not match the ${selectedSurface} surface filter`,
        });
      }
      return rideTimeFits && surfaceFits;
    })
    .sort((left, right) => localGuideRank(left, right, normalizedFilters, originAnchors))
    .map((beach) => localGuideCandidate(beach, normalizedFilters, originAnchors));

  return {
    query,
    filters: normalizedFilters,
    candidates,
    excluded,
    caveats: [
      "Curated local guide data is not a live tide, current, weather, road, access, or lifeguard check.",
      "Ride times are estimates from the General Luna side and can change with exact origin, roadwork, weather, and transport.",
    ],
    sourceSummary,
  };
}

export function localGeoNameMatches(candidateName: string, requestedName: string | undefined) {
  if (!requestedName) {
    return false;
  }
  const normalizedCandidate = normalizeGeoName(candidateName);
  const normalizedRequest = normalizeGeoName(requestedName);
  return (
    normalizedCandidate === normalizedRequest ||
    normalizedCandidate.replace(/\bbeach access\b/g, "") === normalizedRequest ||
    normalizedRequest.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedRequest)
  );
}

export function localGeoAliasOrNameMatches({
  aliases,
  name,
  requestedName,
}: {
  name: string;
  aliases: readonly string[];
  requestedName: string | undefined;
}) {
  return (
    localGeoNameMatches(name, requestedName) ||
    aliases.some((alias) => localGeoNameMatches(alias, requestedName))
  );
}

export function localGeoDistanceKm(left: LocalGeoCoordinates, right: LocalGeoCoordinates) {
  const earthRadiusKm = 6_371;
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeLocalGuideFilters(
  query: string,
  filters: LocalGuideSearchFilters,
  beachRecords: readonly LocalGeoBeachRecord[],
  originAnchors: readonly LocalGeoOriginAnchor[],
): LocalGuideSearchFilters {
  const excludedBeachNames = uniqueText([
    ...(filters.excludedBeachNames ?? []),
    ...inferExcludedBeachNames(query, beachRecords),
  ]);
  const wantsSand = /\bsand(?:y)?|not\s+rocky|avoid\s+rocks?|smooth\s+sand\b/i.test(query);
  const wantsSwimming = /\bswim(?:ming)?|calm\s+water\b/i.test(query);
  const wantsSunset = /\bsunset|late[-\s]?afternoon\b/i.test(query);
  const wantsRain = /\brain|rainy|covered|bad\s+weather\b/i.test(query);
  const wantsNoScooter = /\bno\s+scooter|without\s+(?:a\s+)?scooter|walk(?:ing)?\b/i.test(query);
  const transportMode = filters.transportMode ?? (wantsNoScooter ? "walk" : undefined);
  const originArea = filters.originArea ?? inferOriginArea(query, originAnchors);
  return {
    ...filters,
    ...(excludedBeachNames.length ? { excludedBeachNames } : {}),
    ...(originArea ? { originArea } : {}),
    ...(filters.beachSurface
      ? {}
      : {
          beachSurface: wantsSand ? "sand" : "any",
        }),
    swimming: filters.swimming ?? wantsSwimming,
    sunset: filters.sunset ?? wantsSunset,
    rainFit: filters.rainFit ?? wantsRain,
    ...(transportMode ? { transportMode } : {}),
    ...(filters.maxRideMinutes === undefined && transportMode === "walk"
      ? { maxRideMinutes: 20 }
      : {}),
  };
}

function localGuideCandidate(
  beach: LocalGeoBeachRecord,
  filters: LocalGuideSearchFilters,
  originAnchors: readonly LocalGeoOriginAnchor[],
): LocalGuideCandidate {
  return {
    name: beach.name,
    area: beach.area,
    rideTimeFromGeneralLunaMinutes: beach.distanceFromGeneralLunaMinutes,
    surface: beach.surface,
    confidence: beach.confidence,
    bestFor: beachBestUse(beach, {
      sunset: filters.sunset,
      swimming: filters.swimming,
    }),
    fitReasons: localGuideFitReasons(beach, filters, originAnchors),
    caveats: [
      beach.tideNotes,
      "No live tide/current/access/lifeguard check.",
      ...(filters.rainFit ? ["Rain fit does not include live road flooding checks."] : []),
      ...(filters.withKids ? ["Re-check conditions in person before letting kids swim."] : []),
      ...(filters.transportMode === "walk"
        ? ["Walking/no-scooter fit depends on your exact accommodation and road conditions."]
        : []),
    ],
    sourceNotes: beach.sourceNotes,
  };
}

function localGuideFitReasons(
  beach: LocalGeoBeachRecord,
  filters: LocalGuideSearchFilters,
  originAnchors: readonly LocalGeoOriginAnchor[],
) {
  const originFit = localGuideOriginFitReason(beach, filters.originArea, originAnchors);
  const reasons = [
    `${rideTimeLabel(beach)}.`,
    originFit,
    `${beach.surface} surface.`,
    filters.swimming ? beach.swimmingFit : undefined,
    filters.sunset ? beach.sunsetFit : undefined,
    filters.rainFit ? beach.rainFit : undefined,
    transportFitReason(beach, filters),
    filters.withKids ? "Family/kids constraint noted; keep conditions conservative." : undefined,
  ];
  return reasons.filter((reason): reason is string => Boolean(reason));
}

function localGuideRank(
  left: LocalGeoBeachRecord,
  right: LocalGeoBeachRecord,
  filters: LocalGuideSearchFilters,
  originAnchors: readonly LocalGeoOriginAnchor[],
) {
  return (
    localGuideScore(right, filters, originAnchors) -
      localGuideScore(left, filters, originAnchors) ||
    left.distanceFromGeneralLunaMinutes.max - right.distanceFromGeneralLunaMinutes.max ||
    left.name.localeCompare(right.name)
  );
}

function localGuideScore(
  beach: LocalGeoBeachRecord,
  filters: LocalGuideSearchFilters,
  originAnchors: readonly LocalGeoOriginAnchor[],
) {
  let score = 0;
  if (localGeoNameMatches(beach.name, filters.beachName)) {
    score += 100;
  }
  score += originAreaScore(beach, filters.originArea, originAnchors);
  if (filters.swimming && beach.name === "Doot Beach") {
    score += 5;
  }
  if (filters.swimming && beach.name === "Malinao Beach") {
    score += 4;
  }
  if (!filters.swimming && filters.beachSurface === "sand" && beach.name === "Malinao Beach") {
    score += 3;
  }
  if (
    filters.sunset &&
    ["Cloud 9 beach access", "Malinao Beach", "Doot Beach"].includes(beach.name)
  ) {
    score += 3;
  }
  if (filters.rainFit && beach.distanceFromGeneralLunaMinutes.max <= 20) {
    score += 6;
  }
  if (filters.rainFit && beach.distanceFromGeneralLunaMinutes.max > 30) {
    score -= 6;
  }
  if (filters.transportMode === "walk" && beach.distanceFromGeneralLunaMinutes.max <= 20) {
    score += 5;
  }
  if (filters.transportMode === "walk" && beach.distanceFromGeneralLunaMinutes.max > 25) {
    score -= 4;
  }
  if (filters.withKids && beach.surface === "sand") {
    score += 3;
  }
  if (filters.withKids && beach.surface === "rocky") {
    score -= 5;
  }
  if (beach.surface === "rocky") {
    score -= 2;
  }
  return score;
}

function localGuideRideTimeFits({
  beach,
  maxRideMinutes,
  originAnchor,
  usesGeneralLunaRideFilter,
}: {
  beach: LocalGeoBeachRecord;
  maxRideMinutes: number;
  originAnchor: LocalGeoOriginAnchor | undefined;
  usesGeneralLunaRideFilter: boolean;
}) {
  if (usesGeneralLunaRideFilter) {
    return beach.distanceFromGeneralLunaMinutes.max <= maxRideMinutes;
  }
  if (!originAnchor) {
    return true;
  }
  return approximateRideMinutesFromAnchor(beach, originAnchor) <= maxRideMinutes;
}

function localGuideRideTimeExclusionReason({
  beach,
  maxRideMinutes,
  originAnchor,
  usesGeneralLunaRideFilter,
}: {
  beach: LocalGeoBeachRecord;
  maxRideMinutes: number;
  originAnchor: LocalGeoOriginAnchor | undefined;
  usesGeneralLunaRideFilter: boolean;
}) {
  if (usesGeneralLunaRideFilter || !originAnchor) {
    return `usually ${beach.distanceFromGeneralLunaMinutes.min}-${beach.distanceFromGeneralLunaMinutes.max} minutes from General Luna, outside the ${maxRideMinutes}-minute filter`;
  }
  return `not a close ${originAnchor.label} proximity match for the ${maxRideMinutes}-minute filter`;
}

function shouldUseGeneralLunaRideFilter(originArea: string | undefined) {
  return !originArea || /\bgeneral\s+luna\b|\bcloud\s*9\b|\bcatangnan\b/i.test(originArea);
}

function localGuideOriginFitReason(
  beach: LocalGeoBeachRecord,
  originArea: string | undefined,
  originAnchors: readonly LocalGeoOriginAnchor[],
) {
  const anchor = localGuideOriginAnchor(originArea, originAnchors);
  if (!anchor) {
    return undefined;
  }
  const straightLineKm = localGeoDistanceKm(anchor, beach.location);
  if (areaMatchesBeach(beach, anchor.label)) {
    return `Named-area fit for ${anchor.label}.`;
  }
  return `About ${formatOneDecimal(straightLineKm)} km straight-line from ${anchor.label}; route time not live checked.`;
}

function transportFitReason(beach: LocalGeoBeachRecord, filters: LocalGuideSearchFilters) {
  if (!filters.transportMode) {
    return undefined;
  }
  if (filters.transportMode === "walk") {
    return beach.distanceFromGeneralLunaMinutes.max <= 20
      ? "No-scooter/walking constraint favors this close General Luna-side option."
      : "No-scooter/walking constraint makes exact accommodation and road conditions important.";
  }
  return `Transport mode noted: ${filters.transportMode}.`;
}

function originAreaScore(
  beach: LocalGeoBeachRecord,
  originArea: string | undefined,
  originAnchors: readonly LocalGeoOriginAnchor[],
) {
  const anchor = localGuideOriginAnchor(originArea, originAnchors);
  if (!anchor) {
    return 0;
  }
  const distance = localGeoDistanceKm(anchor, beach.location);
  const proximityScore = Math.max(0, 30 - distance * 4);
  return proximityScore + (areaMatchesBeach(beach, anchor.label) ? 35 : 0);
}

function inferOriginArea(query: string, originAnchors: readonly LocalGeoOriginAnchor[]) {
  return originAnchors.find((anchor) =>
    anchor.aliases.some(
      (alias) =>
        new RegExp(
          `\\b(?:near|around|close\\s+to|from|in|by)\\s+(?:the\\s+)?${escapeRegExp(alias)}\\b`,
          "i",
        ).test(query) ||
        new RegExp(`\\b${escapeRegExp(alias)}\\s+(?:area|side)\\b`, "i").test(query),
    ),
  )?.label;
}

function localGuideOriginAnchor(
  originArea: string | undefined,
  originAnchors: readonly LocalGeoOriginAnchor[],
) {
  if (!originArea) {
    return undefined;
  }
  const normalizedArea = normalizeGeoName(originArea);
  return originAnchors.find(
    (anchor) =>
      normalizeGeoName(anchor.label) === normalizedArea ||
      anchor.aliases.some((alias) => normalizeGeoName(alias) === normalizedArea),
  );
}

function areaMatchesBeach(beach: LocalGeoBeachRecord, originArea: string) {
  const normalizedOrigin = normalizeGeoName(originArea);
  return beach.areaKeywords.some((keyword) => normalizeGeoName(keyword) === normalizedOrigin);
}

function inferExcludedBeachNames(query: string, beachRecords: readonly LocalGeoBeachRecord[]) {
  return beachRecords.flatMap((beach) =>
    explicitlyExcludesBeach(query, beach.name) ? [beach.name] : [],
  );
}

function explicitlyExcludesBeach(query: string, beachName: string) {
  const beachPattern = beachNamePattern(beachName);
  return new RegExp(
    `\\b(?:not|no|skip|exclude|excluding|avoid|except|without)\\s+(?:the\\s+)?${beachPattern}\\b`,
    "i",
  ).test(query);
}

function beachNamePattern(beachName: string) {
  return normalizeGeoName(beachName).split(/\s+/).filter(Boolean).map(escapeRegExp).join("\\s+");
}

function approximateRideMinutesFromAnchor(
  beach: LocalGeoBeachRecord,
  anchor: LocalGeoOriginAnchor,
) {
  return Math.ceil(localGeoDistanceKm(anchor, beach.location) * 4);
}

function beachBestUse(beach: LocalGeoBeachRecord, request: BeachRecommendationRequest) {
  if (request.sunset) {
    return beach.sunsetFit;
  }
  if (request.swimming) {
    return beach.swimmingFit;
  }
  if (beach.name === "Doot Beach") {
    return "best for the easiest close sandy beach stop";
  }
  if (beach.name === "Malinao Beach") {
    return "best for a close sandy shoreline and easy fallback ride";
  }
  if (beach.name === "Secret Beach") {
    return "best for a sandy beach stop when surf and currents look comfortable";
  }
  return beach.swimmingFit;
}

function rideTimeLabel(beach: LocalGeoBeachRecord) {
  return `about ${beach.distanceFromGeneralLunaMinutes.min}-${beach.distanceFromGeneralLunaMinutes.max} min from General Luna`;
}

function surfSpotSupportsSkillLevel(spot: LocalGeoSurfSpotRecord, skillLevel: SurfSpotSkillLevel) {
  if (skillLevel === "any") {
    return true;
  }
  for (const supportedLevel of spot.skillLevels) {
    if (supportedLevel === skillLevel) {
      return true;
    }
  }
  return false;
}

function publicRankedSurfSpot(
  spot: LocalGeoSurfSpotRecord,
  center: LocalGeoCoordinates,
  skillLevel: SurfSpotSkillLevel,
): RankedSurfSpot {
  const distanceKm = localGeoDistanceKm(center, spot);
  return {
    id: spot.id,
    name: spot.name,
    aliases: spot.aliases,
    area: spot.area,
    skillLevels: spot.skillLevels,
    access: spot.access,
    caveats: spot.caveats,
    distanceKm: Number(formatOneDecimal(distanceKm)),
    distanceLabel: `About ${formatOneDecimal(distanceKm)} km straight-line from your shared location.`,
    fitReasons: [
      skillLevel === "any"
        ? "included before skill-specific filtering"
        : `matches ${skillLevel} surf ability filter`,
      "ranked by approximate straight-line distance from your shared location",
      spot.access === "boat" ? "boat access required" : `${spot.access} access`,
    ],
  };
}

function normalizeMaxResults(maxResults: number | undefined) {
  if (!Number.isFinite(maxResults) || !maxResults) {
    return 7;
  }
  return Math.min(Math.max(Math.floor(maxResults), 1), maxSurfSpotResults);
}

function fencedJsonBlock(markdown: string, blockName: string) {
  const pattern = new RegExp(
    `\`\`\`json\\s+${escapeRegExp(blockName)}\\s*\\n([\\s\\S]*?)\\n\`\`\``,
    "u",
  );
  return pattern.exec(markdown)?.[1];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = readString(item);
        return text ? [text] : [];
      })
    : [];
}

function readAccess(value: unknown): SurfSpotAccess | undefined {
  if (value === "shore" || value === "paddle" || value === "boat" || value === "local") {
    return value;
  }
  return undefined;
}

function readSkillLevels(value: unknown): Exclude<SurfSpotSkillLevel, "any">[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) =>
    item === "beginner" || item === "intermediate" || item === "advanced" ? [item] : [],
  );
}

function readRideTime(value: unknown): { min: number; max: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const min = readNumber(value.min);
  const max = readNumber(value.max);
  return min !== undefined && max !== undefined && min <= max ? { min, max } : undefined;
}

function readBeachSurface(value: unknown): SiargaoBeachSurface | undefined {
  if (value === "sand" || value === "mixed" || value === "rocky") {
    return value;
  }
  return undefined;
}

function readConfidence(value: unknown): LocalGeoBeachRecord["confidence"] | undefined {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return undefined;
}

function normalizeGeoName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(beach|area|access)\b/g, "")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueText(values: readonly string[]) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const normalizedValue = value.replaceAll(/\s+/g, " ").trim();
        return normalizedValue ? [normalizedValue] : [];
      }),
    ),
  ];
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function formatOneDecimal(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
