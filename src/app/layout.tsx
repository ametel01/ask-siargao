import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/theme/global.css";

export const metadata: Metadata = {
  title: "Siargao Trip Risk Audit",
  description: "Evidence-backed checks for Siargao trip feasibility before you pay.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
