import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/cormorant-garamond/wght.css";
import "@fontsource-variable/nunito-sans/wght.css";
import { SkipToMainContent } from "@/components/SkipToMainContent";
import "@/theme/global.css";

export const metadata: Metadata = {
  applicationName: "Ask Siargao",
  title: "Ask Siargao",
  description:
    "A chat-first Siargao travel assistant for stays, food, weather, transfers, and local trip questions.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ask Siargao",
  },
};

export const viewport: Viewport = {
  themeColor: "#05082a",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SkipToMainContent />
        {children}
      </body>
    </html>
  );
}
