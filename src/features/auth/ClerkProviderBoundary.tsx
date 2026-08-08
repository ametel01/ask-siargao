import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";

export function ClerkProviderBoundary({ children }: { children: ReactNode }) {
  if (!isClerkServerConfigured) {
    return children;
  }

  return <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>;
}
