import type { Metadata } from "next";

import { TripPassLegalPage } from "@/features/trip-pass/TripPassLegalPage";

export const metadata: Metadata = {
  title: "Trip Pass Terms | Ask Siargao",
  description:
    "Ask Siargao Trip Pass limits, activation, expiry, refund, privacy, provider availability, and support terms.",
};

export default function Page() {
  return <TripPassLegalPage />;
}
