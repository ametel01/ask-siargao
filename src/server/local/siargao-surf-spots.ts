import {
  type LocalGeoSurfSpotRecord,
  loadSurfSpotGeoReferencesFromMarkdown,
  type RankedSurfSpot,
  type RankSurfSpotsNearbyInput,
  rankSurfSpotReferences,
  type SurfSpotAccess,
  type SurfSpotSkillLevel,
} from "@/server/local/local-geo-reference";

export type { RankedSurfSpot, RankSurfSpotsNearbyInput, SurfSpotAccess, SurfSpotSkillLevel };

export type SurfSpot = LocalGeoSurfSpotRecord;

export function parseSurfSpotDistanceAnchors(markdown: string): SurfSpot[] {
  return loadSurfSpotGeoReferencesFromMarkdown(markdown).records;
}

export function rankSurfSpotsNearby(input: RankSurfSpotsNearbyInput): RankedSurfSpot[] {
  return rankSurfSpotReferences(input);
}
