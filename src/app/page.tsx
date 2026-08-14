import type { Metadata } from "next";

import { LandingPage } from "@/features/landing/LandingPage";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";

export const metadata: Metadata = {
  alternates: { canonical: buildCanonicalSiteUrl("/") },
  robots: { index: true, follow: true },
};

export default function Home() {
  return <LandingPage />;
}
