import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  type BeachRecommendationRequest,
  type LocalGeoBeachRecord,
  type LocalGuideCandidate,
  type LocalGuideExcludedCandidate,
  type LocalGuideSearchFilters,
  type LocalGuideSearchResult,
  loadStaticLocalGeoReferences,
  normalizeLocalGeoBeachRecord,
  normalizeLocalGeoOriginAnchor,
  type SiargaoBeachSurface,
  searchLocalGeoBeachGuide,
} from "@/server/local/local-geo-reference";

export type {
  BeachRecommendationRequest,
  LocalGuideCandidate,
  LocalGuideExcludedCandidate,
  LocalGuideSearchFilters,
  LocalGuideSearchResult,
  SiargaoBeachSurface,
};

export type SiargaoBeach = LocalGeoBeachRecord;

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
  return searchLocalGeoBeachGuide({
    query,
    filters,
    beachRecords: loadStaticLocalGeoReferences({
      adapterId: "static:siargao-beach-guide",
      records: siargaoBeachGuide,
      normalizeRecord: normalizeLocalGeoBeachRecord,
    }).records,
    originAnchors: loadStaticLocalGeoReferences({
      adapterId: "static:siargao-local-origin-anchors",
      records: localGuideOriginAnchors,
      normalizeRecord: normalizeLocalGeoOriginAnchor,
    }).records,
    sourceSummary: beachGuideSourceSummary,
  });
}
