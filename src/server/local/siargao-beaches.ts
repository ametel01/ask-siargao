import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

export type SiargaoBeachSurface = "sand" | "mixed" | "rocky";

export type SiargaoBeach = {
  name: string;
  area: string;
  areaKeywords: readonly string[];
  location: { latitude: number; longitude: number };
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
  confidence: SiargaoBeach["confidence"];
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

const siargaoBeachGuide: SiargaoBeach[] = [
  {
    name: "Doot Beach",
    area: "Doot / General Luna side",
    areaKeywords: ["doot", "general luna", "malinao"],
    location: { latitude: 9.765, longitude: 126.118 },
    distanceFromGeneralLunaMinutes: { min: 15, max: 25 },
    surface: "sand",
    swimmingFit: "usually one of the easier sandy options close to General Luna",
    sunsetFit: "good for a quiet late-afternoon sandy beach stop, not a guaranteed horizon sunset",
    surfFit: "not a surf pick; choose it for a quieter beach stop",
    rainFit: "reasonable for a short close ride, but avoid if roads are flooding",
    tideNotes: "entry and water depth can vary with tide",
    confidence: "medium",
    sourceNotes: "Curated local guide estimate; exact ride time depends on start point and roads.",
  },
  {
    name: "Malinao Beach",
    area: "Malinao",
    areaKeywords: ["malinao", "general luna"],
    location: { latitude: 9.753, longitude: 126.121 },
    distanceFromGeneralLunaMinutes: { min: 10, max: 20 },
    surface: "sand",
    swimmingFit: "good sandy shoreline candidate when conditions are calm",
    sunsetFit: "good for a relaxed late-afternoon walk if you want to stay close to General Luna",
    surfFit: "better for a beach walk or swim than surf",
    rainFit: "close enough to keep as a flexible bad-weather fallback",
    tideNotes: "some stretches are better at mid to high tide",
    confidence: "medium",
    sourceNotes: "Curated local guide estimate for sandy stretches around Malinao.",
  },
  {
    name: "Secret Beach",
    area: "Guiwan / General Luna side",
    areaKeywords: ["guiwan", "giwan", "general luna", "secret beach"],
    location: { latitude: 9.766, longitude: 126.112 },
    distanceFromGeneralLunaMinutes: { min: 15, max: 25 },
    surface: "sand",
    swimmingFit: "sandy, but swim comfort depends on surf and currents",
    sunsetFit: "fine for late-afternoon beach time, but check surf and access before staying long",
    surfFit: "often more useful for small surf or a beach stop than a calm swim",
    rainFit: "keep it for a clear break rather than active rain",
    tideNotes: "check the exact access point and conditions before swimming",
    confidence: "medium",
    sourceNotes: "Curated local guide estimate; access and conditions vary by exact entry point.",
  },
  {
    name: "Union Beach area",
    area: "Union",
    areaKeywords: ["union", "guiwan"],
    location: { latitude: 9.759, longitude: 126.102 },
    distanceFromGeneralLunaMinutes: { min: 20, max: 30 },
    surface: "mixed",
    swimmingFit: "can work for a coastal stop, but not the cleanest sand-only pick",
    sunsetFit: "possible late-afternoon coastal stop, but not ideal for a sand-only filter",
    surfFit: "varies by stretch and conditions",
    rainFit: "borderline for a rainy-day ride from General Luna",
    tideNotes: "expect some mixed entry points depending on the exact stretch",
    confidence: "low",
    sourceNotes: "Included as a broader area, not a guaranteed sand-only access point.",
  },
  {
    name: "Cloud 9 beach access",
    area: "Catangnan / Cloud 9",
    areaKeywords: ["cloud 9", "cloud9", "catangnan"],
    location: { latitude: 9.814, longitude: 126.165 },
    distanceFromGeneralLunaMinutes: { min: 5, max: 15 },
    surface: "rocky",
    swimmingFit: "not the best smooth-sand swimming pick; known more for surf and reef",
    sunsetFit: "good for Cloud 9 atmosphere and surf-watching, but not a sand-only beach pick",
    surfFit: "iconic surf-side stop",
    rainFit: "easy to reach, but exposed in active rain",
    tideNotes: "reef and rocks matter, especially around low tide",
    confidence: "high",
    sourceNotes: "Included to avoid treating Cloud 9 as a sand-only swimming beach.",
  },
  {
    name: "Pacifico Beach",
    area: "Pacifico / San Isidro",
    areaKeywords: ["pacifico", "san isidro", "north siargao"],
    location: { latitude: 9.954, longitude: 126.088 },
    distanceFromGeneralLunaMinutes: { min: 65, max: 90 },
    surface: "sand",
    swimmingFit: "sandy in stretches, but not a strict 30-minute option from General Luna",
    sunsetFit:
      "better treated as a longer north-island beach trip, not a quick sunset hop from General Luna",
    surfFit: "better known as a north-island surf/coastal trip",
    rainFit: "not ideal during rain because of the longer ride",
    tideNotes: "conditions vary by swell and exact beach stretch",
    confidence: "medium",
    sourceNotes: "Kept in the dataset so strict 30-minute filters can explicitly exclude it.",
  },
  {
    name: "Alegria Beach",
    area: "Santa Monica / north Siargao",
    areaKeywords: ["alegria", "santa monica", "north siargao"],
    location: { latitude: 10.023, longitude: 126.04 },
    distanceFromGeneralLunaMinutes: { min: 80, max: 110 },
    surface: "sand",
    swimmingFit: "sandy and scenic, but too far for a 30-minute General Luna beach list",
    sunsetFit: "scenic, but too far for a strict 30-minute sunset plan from General Luna",
    surfFit: "not the main reason to go",
    rainFit: "not recommended as a rainy-day ride from General Luna",
    tideNotes: "still check local conditions before swimming",
    confidence: "medium",
    sourceNotes: "Kept in the dataset so strict 30-minute filters can explicitly exclude it.",
  },
];

const beachGuideSourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["ride-time notes", "beach-surface notes"],
  notChecked: [
    "live road conditions",
    "tide",
    "currents",
    "beach access changes",
    "lifeguard or swimming safety",
  ],
};

const localGuideOriginAnchors = [
  {
    label: "Cloud 9",
    aliases: ["cloud 9", "cloud9", "catangnan"],
    latitude: 9.814,
    longitude: 126.165,
  },
  { label: "General Luna", aliases: ["general luna", "gl"], latitude: 9.784, longitude: 126.158 },
  { label: "Malinao", aliases: ["malinao"], latitude: 9.753, longitude: 126.121 },
  { label: "Doot", aliases: ["doot"], latitude: 9.765, longitude: 126.118 },
  { label: "Union", aliases: ["union"], latitude: 9.759, longitude: 126.102 },
  { label: "Pacifico", aliases: ["pacifico"], latitude: 9.954, longitude: 126.088 },
  { label: "Alegria", aliases: ["alegria"], latitude: 10.023, longitude: 126.04 },
  { label: "Del Carmen", aliases: ["del carmen"], latitude: 9.869, longitude: 125.971 },
  { label: "Dapa", aliases: ["dapa"], latitude: 9.759, longitude: 126.052 },
] as const;

export function searchSiargaoLocalGuide({
  filters = {},
  query,
}: {
  query: string;
  filters?: LocalGuideSearchFilters;
}): LocalGuideSearchResult {
  const normalizedFilters = normalizeLocalGuideFilters(query, filters);
  const maxRideMinutes = normalizedFilters.maxRideMinutes ?? 45;
  const selectedSurface = normalizedFilters.beachSurface ?? "any";
  const requestedBeachName = normalizedFilters.beachName;
  const excludedBeachNames = normalizedFilters.excludedBeachNames ?? [];
  const originAnchor = localGuideOriginAnchor(normalizedFilters.originArea);
  const usesGeneralLunaRideFilter = shouldUseGeneralLunaRideFilter(normalizedFilters.originArea);
  const excluded: LocalGuideExcludedCandidate[] = [];
  const candidates = siargaoBeachGuide
    .filter((beach) => {
      const explicitlyExcluded = excludedBeachNames.some((excludedName) =>
        beachNameMatches(beach.name, excludedName),
      );
      const nameFits = beachNameMatches(beach.name, requestedBeachName);
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
    .sort((left, right) => localGuideRank(left, right, normalizedFilters))
    .map((beach) => localGuideCandidate(beach, normalizedFilters));

  return {
    query,
    filters: normalizedFilters,
    candidates,
    excluded,
    caveats: [
      "Curated local guide data is not a live tide, current, weather, road, access, or lifeguard check.",
      "Ride times are estimates from the General Luna side and can change with exact origin, roadwork, weather, and transport.",
    ],
    sourceSummary: beachGuideSourceSummary,
  };
}

function normalizeLocalGuideFilters(
  query: string,
  filters: LocalGuideSearchFilters,
): LocalGuideSearchFilters {
  const excludedBeachNames = uniqueText([
    ...(filters.excludedBeachNames ?? []),
    ...inferExcludedBeachNames(query),
  ]);
  const wantsSand = /\bsand(?:y)?|not\s+rocky|avoid\s+rocks?|smooth\s+sand\b/i.test(query);
  const wantsSwimming = /\bswim(?:ming)?|calm\s+water\b/i.test(query);
  const wantsSunset = /\bsunset|late[-\s]?afternoon\b/i.test(query);
  const wantsRain = /\brain|rainy|covered|bad\s+weather\b/i.test(query);
  const wantsNoScooter = /\bno\s+scooter|without\s+(?:a\s+)?scooter|walk(?:ing)?\b/i.test(query);
  const transportMode = filters.transportMode ?? (wantsNoScooter ? "walk" : undefined);
  const originArea = filters.originArea ?? inferOriginArea(query);
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
  beach: SiargaoBeach,
  filters: LocalGuideSearchFilters,
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
    fitReasons: localGuideFitReasons(beach, filters),
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

function localGuideFitReasons(beach: SiargaoBeach, filters: LocalGuideSearchFilters) {
  const originFit = localGuideOriginFitReason(beach, filters.originArea);
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

function localGuideRank(left: SiargaoBeach, right: SiargaoBeach, filters: LocalGuideSearchFilters) {
  return (
    localGuideScore(right, filters) - localGuideScore(left, filters) ||
    left.distanceFromGeneralLunaMinutes.max - right.distanceFromGeneralLunaMinutes.max ||
    left.name.localeCompare(right.name)
  );
}

function localGuideScore(beach: SiargaoBeach, filters: LocalGuideSearchFilters) {
  let score = 0;
  if (beachNameMatches(beach.name, filters.beachName)) {
    score += 100;
  }
  score += originAreaScore(beach, filters.originArea);
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
  beach: SiargaoBeach;
  maxRideMinutes: number;
  originAnchor: (typeof localGuideOriginAnchors)[number] | undefined;
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
  beach: SiargaoBeach;
  maxRideMinutes: number;
  originAnchor: (typeof localGuideOriginAnchors)[number] | undefined;
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

function localGuideOriginFitReason(beach: SiargaoBeach, originArea: string | undefined) {
  const anchor = localGuideOriginAnchor(originArea);
  if (!anchor) {
    return undefined;
  }
  const straightLineKm = distanceKm(anchor, beach.location);
  if (areaMatchesBeach(beach, anchor.label)) {
    return `Named-area fit for ${anchor.label}.`;
  }
  return `About ${formatOneDecimal(straightLineKm)} km straight-line from ${anchor.label}; route time not live checked.`;
}

function transportFitReason(beach: SiargaoBeach, filters: LocalGuideSearchFilters) {
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

function originAreaScore(beach: SiargaoBeach, originArea: string | undefined) {
  const anchor = localGuideOriginAnchor(originArea);
  if (!anchor) {
    return 0;
  }
  const distance = distanceKm(anchor, beach.location);
  const proximityScore = Math.max(0, 30 - distance * 4);
  return proximityScore + (areaMatchesBeach(beach, anchor.label) ? 35 : 0);
}

function inferOriginArea(query: string) {
  return localGuideOriginAnchors.find((anchor) =>
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

function localGuideOriginAnchor(originArea: string | undefined) {
  if (!originArea) {
    return undefined;
  }
  const normalizedArea = normalizeBeachName(originArea);
  return localGuideOriginAnchors.find(
    (anchor) =>
      normalizeBeachName(anchor.label) === normalizedArea ||
      anchor.aliases.some((alias) => normalizeBeachName(alias) === normalizedArea),
  );
}

function areaMatchesBeach(beach: SiargaoBeach, originArea: string) {
  const normalizedOrigin = normalizeBeachName(originArea);
  return beach.areaKeywords.some((keyword) => normalizeBeachName(keyword) === normalizedOrigin);
}

function beachNameMatches(beachName: string, requestedName: string | undefined) {
  if (!requestedName) {
    return false;
  }
  const normalizedBeach = normalizeBeachName(beachName);
  const normalizedRequest = normalizeBeachName(requestedName);
  return (
    normalizedBeach === normalizedRequest ||
    normalizedBeach.replace(/\bbeach access\b/g, "") === normalizedRequest ||
    normalizedRequest.includes(normalizedBeach) ||
    normalizedBeach.includes(normalizedRequest)
  );
}

function normalizeBeachName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(beach|area|access)\b/g, "")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferExcludedBeachNames(query: string) {
  return siargaoBeachGuide.flatMap((beach) =>
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
  return normalizeBeachName(beachName).split(/\s+/).filter(Boolean).map(escapeRegExp).join("\\s+");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function approximateRideMinutesFromAnchor(
  beach: SiargaoBeach,
  anchor: (typeof localGuideOriginAnchors)[number],
) {
  return Math.ceil(distanceKm(anchor, beach.location) * 4);
}

function distanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
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

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function formatOneDecimal(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function beachBestUse(beach: SiargaoBeach, request: BeachRecommendationRequest) {
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

function rideTimeLabel(beach: SiargaoBeach) {
  return `about ${beach.distanceFromGeneralLunaMinutes.min}-${beach.distanceFromGeneralLunaMinutes.max} min from General Luna`;
}
