import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ClerkProviderBoundary } from "@/features/auth/ClerkProviderBoundary";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";
import { AppBackdrop, appNightPanelClass, BrandLockup } from "@/ui/components/ask-siargao";

export default function SignInPage() {
  if (!isClerkConfigured) {
    return <ClerkUnavailable actionLabel="Sign in" />;
  }

  return (
    <ClerkProviderBoundary>
      <AppBackdrop className="grid place-items-center px-4 py-10">
        <section className="grid justify-items-center gap-5">
          <Link aria-label="Ask Siargao home" className="no-underline" href="/">
            <BrandLockup />
          </Link>
          <SignIn appearance={clerkAppearance} />
        </section>
      </AppBackdrop>
    </ClerkProviderBoundary>
  );
}

function ClerkUnavailable({ actionLabel }: { actionLabel: string }) {
  return (
    <AppBackdrop className="grid place-items-center px-4 py-10">
      <section className={`${appNightPanelClass} grid max-w-md gap-4`}>
        <BrandLockup />
        <h1 className="m-0 font-heading text-3xl leading-none font-semibold text-[#fff9e9]">
          {actionLabel} unavailable
        </h1>
        <p className="m-0 text-sm leading-6 text-text-on-dark-muted">
          Clerk environment variables are not configured for this environment.
        </p>
        <Button
          asChild
          className="min-h-11 w-fit rounded-md bg-[image:var(--gradient-lagoon-cta)] px-4"
          type="button"
        >
          <Link href="/chat">Back to chat</Link>
        </Button>
      </section>
    </AppBackdrop>
  );
}
