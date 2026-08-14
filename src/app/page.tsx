import type { Metadata } from "next";

import { LandingPage } from "@/features/landing/LandingPage";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import { buildIndexablePageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildIndexablePageMetadata({
  title: "Ask Siargao | Live, Local Siargao Travel Advice",
  description:
    "Get live, local Siargao travel advice for stays, routes, surf, weather, disruptions, and trip decisions shaped around your real constraints.",
  canonicalUrl: buildCanonicalSiteUrl("/"),
});

export default function Home() {
  return <LandingPage />;
}
