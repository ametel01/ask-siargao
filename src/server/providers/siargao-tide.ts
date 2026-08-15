import { buildPacioosTideSnapshot } from "@/server/providers/pacioos-tide";
import { isProductionProviderEnvironment } from "@/server/providers/production-provider-mode";
import {
  buildTideForecastSnapshot,
  type TideForecastDateRange,
  type TideForecastLocation,
} from "@/server/providers/tide-forecast";

export async function buildSiargaoTideSnapshot(input: {
  dateRange: TideForecastDateRange;
  env?: Record<string, string | undefined>;
  fetchedAt?: Date;
  fetcher?: Parameters<typeof buildTideForecastSnapshot>[0]["fetcher"];
  location?: TideForecastLocation;
  requestedLocation: string;
}) {
  const env = input.env ?? process.env;
  if (isProductionProviderEnvironment(env)) {
    return buildPacioosTideSnapshot(input);
  }
  return buildTideForecastSnapshot(input);
}
