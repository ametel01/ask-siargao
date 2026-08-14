import type { Metadata } from "next";

import { PrivacyNoticePage } from "@/features/legal/PrivacyNoticePage";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import { buildIndexablePageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildIndexablePageMetadata({
  title: "Privacy Notice | Ask Siargao",
  description: "How Ask Siargao processes chat, account, location, provider, and operational data.",
  canonicalUrl: buildCanonicalSiteUrl("/legal/privacy"),
});

export default function Page() {
  return <PrivacyNoticePage />;
}
