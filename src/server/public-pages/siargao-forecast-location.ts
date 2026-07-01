import {
  type OpenMeteoForecastLocation,
  siargaoForecastLocations,
} from "@/server/providers/open-meteo";

export const siargaoPublicForecastLocations = [
  "Siargao Island",
  "Cloud 9",
  "General Luna",
  "Del Carmen",
] as const;

export type SiargaoPublicForecastLocation = (typeof siargaoPublicForecastLocations)[number];

export function parseSiargaoPublicForecastLocation(
  value: string | null | undefined,
): SiargaoPublicForecastLocation {
  const normalizedValue = value?.trim().toLowerCase();
  if (normalizedValue === "del carmen" || normalizedValue === "del-carmen") {
    return "Del Carmen";
  }
  if (normalizedValue === "general luna" || normalizedValue === "general-luna") {
    return "General Luna";
  }
  if (
    normalizedValue === "cloud 9" ||
    normalizedValue === "cloud9" ||
    normalizedValue === "cloud-9"
  ) {
    return "Cloud 9";
  }
  return "Siargao Island";
}

export function openMeteoLocationForPublicLabel(
  location: SiargaoPublicForecastLocation,
): OpenMeteoForecastLocation | undefined {
  if (location === "Del Carmen") {
    return siargaoForecastLocations.delCarmen;
  }
  if (location === "Cloud 9" || location === "General Luna") {
    return siargaoForecastLocations.generalLuna;
  }
  return undefined;
}
