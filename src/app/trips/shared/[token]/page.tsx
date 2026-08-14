import type { Metadata } from "next";

import { sharedTripPageForToken } from "@/app/trips/shared/[token]/page-content";
import { buildNoIndexPageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildNoIndexPageMetadata({
  title: "Shared Siargao plan | Ask Siargao",
});

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return sharedTripPageForToken(token);
}
