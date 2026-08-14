import type { Metadata } from "next";

import { LandingPage } from "@/features/landing/LandingPage";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import { serializeJsonForHtmlScript } from "@/server/public-pages/html-json";
import { buildIndexablePageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildIndexablePageMetadata({
  title: "Ask Siargao | Live, Local Siargao Travel Advice",
  description:
    "Get live, local Siargao travel advice for stays, routes, surf, weather, disruptions, and trip decisions shaped around your real constraints.",
  canonicalUrl: buildCanonicalSiteUrl("/"),
});

export default function Home() {
  const homepageUrl = buildCanonicalSiteUrl("/");
  const organizationId = `${homepageUrl}#organization`;

  return (
    <>
      <script type="application/ld+json">
        {serializeJsonForHtmlScript({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              "@id": `${homepageUrl}#website`,
              name: "Ask Siargao",
              url: homepageUrl,
              publisher: { "@id": organizationId },
            },
            {
              "@type": "Organization",
              "@id": organizationId,
              name: "Ask Siargao",
              url: homepageUrl,
              logo: buildCanonicalSiteUrl("/ask_siargao_palm_icon.svg"),
            },
          ],
        })}
      </script>
      <LandingPage />
    </>
  );
}
