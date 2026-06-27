import type { Metadata } from "next";

import { SharedTripPlanPage } from "@/features/trips/SharedTripPlanPage";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { lookupSharedTripPlanByToken } from "@/server/trips/shared-trip-store";
import type { SharedTripPlan } from "@/server/trips/shared-trip-types";

export const metadata: Metadata = {
  title: "Shared Siargao plan | Ask Siargao",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return sharedTripPageForToken(token);
}

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
