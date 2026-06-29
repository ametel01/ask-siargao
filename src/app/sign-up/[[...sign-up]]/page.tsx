import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";

export default function SignUpPage() {
  if (!isClerkConfigured) {
    return <ClerkUnavailable actionLabel="Sign up" />;
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[linear-gradient(135deg,#05082a_0%,#091133_52%,#0e2c3d_100%)] px-4 py-10">
      <SignUp appearance={clerkAppearance} />
    </main>
  );
}

function ClerkUnavailable({ actionLabel }: { actionLabel: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[linear-gradient(135deg,#05082a_0%,#091133_52%,#0e2c3d_100%)] px-4 py-10 text-text-on-dark">
      <section className="grid max-w-md gap-4 rounded-lg border border-white/14 bg-white/10 p-6 shadow-[0_22px_70px_rgba(0,0,0,0.24)]">
        <h1 className="m-0 text-2xl font-black">{actionLabel} unavailable</h1>
        <p className="m-0 text-sm leading-6 text-text-on-dark-muted">
          Clerk environment variables are not configured for this environment.
        </p>
        <Button asChild className="w-fit rounded-md" type="button">
          <Link href="/chat">Back to chat</Link>
        </Button>
      </section>
    </main>
  );
}
