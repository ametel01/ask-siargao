import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/theme/global.css";

export const metadata: Metadata = {
  title: "Ask Siargao",
  description:
    "A chat-first Siargao travel assistant for stays, food, weather, transfers, and local trip questions.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
