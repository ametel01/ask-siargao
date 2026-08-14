import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { SkipToMainContent } from "@/components/SkipToMainContent";
import "@/theme/global.css";

const cormorantGaramond = localFont({
  display: "swap",
  fallback: ["Iowan Old Style", "Georgia", "Times New Roman"],
  src: "../../node_modules/@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-normal.woff2",
  variable: "--font-cormorant-garamond",
  weight: "300 700",
});

const nunitoSans = localFont({
  display: "swap",
  fallback: ["Avenir Next", "Segoe UI", "Arial"],
  src: "../../node_modules/@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2",
  variable: "--font-nunito-sans",
  weight: "200 1000",
});

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
    <html className={`${cormorantGaramond.variable} ${nunitoSans.variable}`} lang="en">
      <body>
        <SkipToMainContent />
        {children}
      </body>
    </html>
  );
}
