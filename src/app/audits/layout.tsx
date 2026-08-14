import type { Metadata } from "next";
import type { ReactNode } from "react";

import { buildNoIndexPageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildNoIndexPageMetadata({
  title: "Private Travel Audit | Ask Siargao",
});

export default function AuditsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
