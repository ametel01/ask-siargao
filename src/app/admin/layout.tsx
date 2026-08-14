import type { Metadata } from "next";
import type { ReactNode } from "react";

import { buildNoIndexPageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildNoIndexPageMetadata({
  title: "Admin | Ask Siargao",
});

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
