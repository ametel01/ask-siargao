import type Stripe from "stripe";

import { createStripeServerClient } from "@/server/payments/stripe";
import type { AccountClosureProviders } from "@/server/privacy/account-closure";
import {
  combineAbortSignals,
  providerRequestTimeoutMs,
  runProviderOperation,
} from "@/server/providers/provider-abort";

export const clerkBackendApiUrl = "https://api.clerk.com";

export function readProductionClerkApiUrl(env: Record<string, string | undefined> = process.env) {
  const configured = env.CLERK_API_URL;
  if (configured !== undefined && configured !== clerkBackendApiUrl) {
    throw new Error("CLERK_API_URL must be exactly https://api.clerk.com in production.");
  }
  return clerkBackendApiUrl;
}

export function createProductionAccountClosureProviders(
  options: {
    testClerkApiUrl?: string;
    createStripeClient?: () => Pick<Stripe, "checkout">;
    env?: Record<string, string | undefined>;
    fetch?: (request: string, init?: RequestInit) => Promise<Response>;
  } = {},
): AccountClosureProviders {
  const env = options.env ?? process.env;
  if (options.testClerkApiUrl && env.NODE_ENV === "production") {
    throw new Error("Custom Clerk API URLs are test-only.");
  }
  const apiUrl = options.testClerkApiUrl ?? readProductionClerkApiUrl(env);
  return {
    async deleteClerkUser(userId, signal) {
      await deleteClerkUserThroughBackendApi(userId, {
        apiUrl,
        fetch: options.fetch,
        secretKey: env.CLERK_SECRET_KEY,
        signal,
      });
    },
    async expireCheckoutSession(sessionId, signal) {
      const stripe = options.createStripeClient?.() ?? createStripeServerClient();
      const session = await runProviderOperation(
        () => stripe.checkout.sessions.retrieve(sessionId),
        signal,
      );
      if (session.status === "open") {
        await runProviderOperation(() => stripe.checkout.sessions.expire(sessionId), signal);
      }
    },
  };
}

export async function deleteClerkUserThroughBackendApi(
  userId: string,
  options: {
    fetch?: (request: string, init?: RequestInit) => Promise<Response>;
    secretKey?: string;
    apiUrl?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
) {
  if (!options.secretKey) throw new Error("clerk_configuration_unavailable");
  const signal = combineAbortSignals([
    options.signal,
    AbortSignal.timeout(options.timeoutMs ?? providerRequestTimeoutMs),
  ]);
  const apiUrl = (options.apiUrl ?? clerkBackendApiUrl).replace(/\/$/, "");
  const response = await (options.fetch ?? fetch)(
    `${apiUrl}/v1/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${options.secretKey}` },
      signal,
    },
  );
  if (response.status === 404) return;
  if (!response.ok) throw new Error("clerk_user_deletion_failed");
}
