import type { Metadata } from "next";

import { SharedTripPlanPage } from "@/features/trips/SharedTripPlanPage";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { lookupSharedTripPlanByToken } from "@/server/trips/shared-trip-store";

export const metadata: Metadata = {
  title: "Shared Siargao plan | Ask Siargao",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await lookupSharedTripPlanByToken(getDefaultDatabaseQueryClient(), {
    publicToken: token,
  });

  return <SharedTripPlanPage plan={plan} />;
}
