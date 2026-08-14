import type { Metadata } from "next";

import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";

const siteName = "Ask Siargao";
const socialImage = {
  url: buildCanonicalSiteUrl("/images/siargao-sunset.png"),
  width: 1_920,
  height: 1_080,
  alt: "Illustrated Siargao sunset framed by palm trees",
};

export function buildIndexablePageMetadata({
  canonicalUrl,
  description,
  title,
}: {
  canonicalUrl: string;
  description: string;
  title: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "website",
      locale: "en_PH",
      url: canonicalUrl,
      title,
      description,
      siteName,
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: socialImage.url, alt: socialImage.alt }],
    },
    robots: { index: true, follow: true },
  };
}

export function buildNoIndexPageMetadata({
  description,
  title,
}: {
  description?: string;
  title: string;
}): Metadata {
  return {
    title,
    description,
    robots: { index: false, follow: true },
  };
}
