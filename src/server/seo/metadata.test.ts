import { describe, expect, test } from "bun:test";

import { buildIndexablePageMetadata, buildNoIndexPageMetadata } from "@/server/seo/metadata";

describe("SEO metadata", () => {
  test("keeps canonical and social metadata aligned for an indexable page", () => {
    const metadata = buildIndexablePageMetadata({
      title: "General Luna | Ask Siargao",
      description: "Plan a stay in General Luna with current local context.",
      canonicalUrl: "https://www.asksiargao.com/areas/general-luna",
    });

    expect(metadata).toEqual({
      title: "General Luna | Ask Siargao",
      description: "Plan a stay in General Luna with current local context.",
      alternates: { canonical: "https://www.asksiargao.com/areas/general-luna" },
      openGraph: {
        type: "website",
        locale: "en_PH",
        url: "https://www.asksiargao.com/areas/general-luna",
        title: "General Luna | Ask Siargao",
        description: "Plan a stay in General Luna with current local context.",
        siteName: "Ask Siargao",
        images: [
          {
            url: "https://www.asksiargao.com/images/siargao-sunset.png",
            width: 1_920,
            height: 1_080,
            alt: "Illustrated Siargao sunset framed by palm trees",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: "General Luna | Ask Siargao",
        description: "Plan a stay in General Luna with current local context.",
        images: [
          {
            url: "https://www.asksiargao.com/images/siargao-sunset.png",
            alt: "Illustrated Siargao sunset framed by palm trees",
          },
        ],
      },
      robots: { index: true, follow: true },
    });
  });

  test("keeps private and utility pages out of search results", () => {
    expect(buildNoIndexPageMetadata({ title: "Settings | Ask Siargao" })).toEqual({
      title: "Settings | Ask Siargao",
      description: undefined,
      robots: { index: false, follow: false },
    });
  });
});
