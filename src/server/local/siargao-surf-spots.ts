export type SurfSpotSkillLevel = "beginner" | "intermediate" | "advanced" | "any";

export type SurfSpotAccess = "shore" | "paddle" | "boat" | "local";

export type SurfSpot = {
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

export type RankedSurfSpot = Omit<SurfSpot, "latitude" | "longitude"> & {
  distanceKm: number;
  distanceLabel: string;
};

export type RankSurfSpotsNearbyInput = {
  center: {
    latitude: number;
    longitude: number;
  };
  spots: readonly SurfSpot[];
  skillLevel?: SurfSpotSkillLevel;
  maxResults?: number;
  includeBoatAccess?: boolean;
};

const maxSurfSpotResults = 10;

export function parseSurfSpotDistanceAnchors(markdown: string): SurfSpot[] {
  const block = /```json\s+surf_spot_distance_anchors\s*\n([\s\S]*?)\n```/u.exec(markdown)?.[1];
  if (!block) {
    return [];
  }

  const parsed = JSON.parse(block) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((value) => {
    const spot = parseSurfSpot(value);
    return spot ? [spot] : [];
  });
}

export function rankSurfSpotsNearby(input: RankSurfSpotsNearbyInput): RankedSurfSpot[] {
  const skillLevel = input.skillLevel ?? "any";
  const maxResults = normalizeMaxResults(input.maxResults);
  return input.spots
    .filter((spot) => input.includeBoatAccess !== false || spot.access !== "boat")
    .filter((spot) => skillLevel === "any" || spot.skillLevels.includes(skillLevel))
    .map((spot) => publicRankedSurfSpot(spot, input.center))
    .sort(
      (left, right) => left.distanceKm - right.distanceKm || left.name.localeCompare(right.name),
    )
    .slice(0, maxResults);
}

function parseSurfSpot(value: unknown): SurfSpot | undefined {
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
  if (!id || !name || !area || !access || !latitude || !longitude || skillLevels.length === 0) {
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

function publicRankedSurfSpot(
  spot: SurfSpot,
  center: { latitude: number; longitude: number },
): RankedSurfSpot {
  const distanceKm = haversineDistanceMeters(center, spot) / 1000;
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
  };
}

function normalizeMaxResults(maxResults: number | undefined) {
  if (!Number.isFinite(maxResults) || !maxResults) {
    return 7;
  }
  return Math.min(Math.max(Math.floor(maxResults), 1), maxSurfSpotResults);
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

function haversineDistanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function formatOneDecimal(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
