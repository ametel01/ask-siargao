import type { Metadata } from "next";

import { sharedTripPageForToken } from "@/app/trips/shared/[token]/page-content";

export const metadata: Metadata = {
  title: "Shared Siargao plan | Ask Siargao",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return sharedTripPageForToken(token);
}
