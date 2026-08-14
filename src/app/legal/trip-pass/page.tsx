import type { Metadata } from "next";

import { TripPassLegalPage } from "@/features/trip-pass/TripPassLegalPage";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import { buildIndexablePageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildIndexablePageMetadata({
  title: "Trip Pass Terms | Ask Siargao",
  description:
    "Ask Siargao Trip Pass limits, activation, expiry, refund, privacy, provider availability, and support terms.",
  canonicalUrl: buildCanonicalSiteUrl("/legal/trip-pass"),
});

export default function Page() {
  return <TripPassLegalPage />;
}
