import { SharedTripPlanPage } from "@/features/trips/SharedTripPlanPage";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { lookupSharedTripPlanByToken } from "@/server/trips/shared-trip-store";
import type { SharedTripPlan } from "@/server/trips/shared-trip-types";

export async function sharedTripPageForToken(
  token: string,
  dependencies: {
    lookupPlanByToken?: (token: string) => Promise<SharedTripPlan | null>;
  } = {},
) {
  const plan = dependencies.lookupPlanByToken
    ? await dependencies.lookupPlanByToken(token)
    : await lookupSharedTripPlanByToken(getDefaultDatabaseQueryClient(), {
        publicToken: token,
      });

  return <SharedTripPlanPage plan={plan} />;
}
