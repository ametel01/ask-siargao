import type { Metadata } from "next";

import { PlanningGuidesHubPage } from "@/features/guides/PlanningGuidesHubPage";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import { buildIndexablePageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildIndexablePageMetadata({
  title: "Siargao Planning Guides | Ask Siargao",
  description:
    "Source-visible Siargao travel guides and itineraries with realistic timing, practical caveats, and live Reality Checks.",
  canonicalUrl: buildCanonicalSiteUrl("/guides"),
});

export default function GuidesPage() {
  return <PlanningGuidesHubPage />;
}
