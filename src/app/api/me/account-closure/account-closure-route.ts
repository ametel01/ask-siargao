import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";
import { z } from "zod";

import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  type AccountClosurePolicy,
  accountClosureVerificationConfig,
  beginAccountClosure,
  readAccountClosurePolicy,
} from "@/server/privacy/account-closure";
import { isAllowedMutationOrigin } from "@/server/security/request-origin";

type ClosureAuthSnapshot = {
  userId: string | null;
  has(input: { reverification: typeof accountClosureVerificationConfig }): boolean;
};

export type AccountClosureAuditEvent = {
  at: string;
  operationRef?: string;
  outcome: "authentication_failed" | "reverification_required" | "closed" | "failed";
};

export type AccountClosureRouteDependencies = {
  audit: (event: AccountClosureAuditEvent) => void | Promise<void>;
  auth: () => Promise<ClosureAuthSnapshot>;
  begin: typeof beginAccountClosure;
  db: DatabaseQueryClient;
  now: () => Date;
  policy: AccountClosurePolicy;
  reverificationResponse: () => Response;
};

const requestSchema = z.strictObject({ confirmation: z.literal("CLOSE MY ACCOUNT") });
const privateHeaders = { "cache-control": "private, no-store" };

function defaultDependencies(): AccountClosureRouteDependencies {
  return {
    audit: () => undefined,
    auth: async () => {
      if (!isClerkServerConfigured) {
        return { userId: null, has: () => false };
      }
      const snapshot = await auth();
      return { userId: snapshot.userId, has: snapshot.has };
    },
    begin: beginAccountClosure,
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
    policy: readAccountClosurePolicy(),
    reverificationResponse: () => reverificationErrorResponse(accountClosureVerificationConfig),
  };
}

export async function postAccountClosureResponse(
  request: Request,
  dependencies: AccountClosureRouteDependencies = defaultDependencies(),
) {
  if (!isAllowedMutationOrigin(request)) {
    return Response.json(
      { error: "invalid_request_origin" },
      { status: 403, headers: privateHeaders },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_account_closure_request" },
      { status: 400, headers: privateHeaders },
    );
  }

  const authSnapshot = await dependencies.auth();
  const at = dependencies.now();
  if (!authSnapshot.userId) {
    await dependencies.audit({ at: at.toISOString(), outcome: "authentication_failed" });
    return Response.json({ error: "unauthenticated" }, { status: 401, headers: privateHeaders });
  }
  if (!authSnapshot.has({ reverification: accountClosureVerificationConfig })) {
    await dependencies.audit({ at: at.toISOString(), outcome: "reverification_required" });
    return dependencies.reverificationResponse();
  }

  try {
    const result = await dependencies.begin(
      { now: at, userId: authSnapshot.userId },
      { db: dependencies.db, policy: dependencies.policy },
    );
    await dependencies.audit({
      at: at.toISOString(),
      operationRef: result.operationRef,
      outcome: "closed",
    });
    return Response.json(
      {
        status: result.status,
        operationRef: result.operationRef,
        message: "Account Closure is terminal and local access has ended.",
      },
      { headers: privateHeaders },
    );
  } catch {
    await dependencies.audit({ at: at.toISOString(), outcome: "failed" });
    return Response.json(
      { error: "account_closure_failed" },
      { status: 500, headers: privateHeaders },
    );
  }
}
