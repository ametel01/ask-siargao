import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!isClerkConfigured) {
    return <>{children}</>;
  }

  return <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>;
}
