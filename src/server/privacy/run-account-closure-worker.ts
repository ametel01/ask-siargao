import { clerkClient } from "@clerk/nextjs/server";
import Stripe from "stripe";

import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { readAccountClosurePolicy, runClosureCleanupBatch } from "@/server/privacy/account-closure";

const result = await runClosureCleanupBatch({
  db: getDefaultDatabaseQueryClient(),
  limit: readPositiveLimit(process.env.ACCOUNT_CLOSURE_WORKER_BATCH_SIZE),
  now: new Date(),
  policy: readAccountClosurePolicy(),
  providers: {
    deleteClerkUser: async (userId) => {
      const clerk = await clerkClient();
      try {
        await clerk.users.deleteUser(userId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
    expireCheckoutSession: async (sessionId) => {
      const stripeKey = process.env.STRIPE_RESTRICTED_KEY ?? process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new Error("stripe_configuration_unavailable");
      }
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(sessionId);
      }
    },
  },
});

console.info(JSON.stringify({ attempted: result.attempted, checked: "account-closure-worker" }));

function readPositiveLimit(raw: string | undefined) {
  if (!raw?.trim()) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("ACCOUNT_CLOSURE_WORKER_BATCH_SIZE must be a positive integer.");
  }
  return value;
}

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}
