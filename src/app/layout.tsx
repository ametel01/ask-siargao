import type { Metadata } from "next";
import { Cormorant_Garamond, Nunito_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { SkipToMainContent } from "@/components/SkipToMainContent";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/theme/global.css";

const bodyFont = Nunito_Sans({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "600", "700", "800", "900"],
});

const displayFont = Cormorant_Garamond({
  display: "swap",
  subsets: ["latin"],
  style: "normal",
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Ask Siargao",
  description:
    "A chat-first Siargao travel assistant for stays, food, weather, transfers, and local trip questions.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const appContent = (
    <>
      <SkipToMainContent />
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster position="top-center" richColors />
    </>
  );

  return (
    <html className={`${bodyFont.variable} ${displayFont.variable}`} lang="en">
      <body>{appContent}</body>
    </html>
  );
}
