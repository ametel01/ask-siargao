import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/cormorant-garamond/latin-700.css";
import "@fontsource/nunito-sans/latin-400.css";
import "@fontsource/nunito-sans/latin-600.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-800.css";
import "@fontsource/nunito-sans/latin-900.css";
import { SkipToMainContent } from "@/components/SkipToMainContent";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/theme/global.css";

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
    <html lang="en">
      <body>{appContent}</body>
    </html>
  );
}
