import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";

import { postOperatorRefundResponse } from "@/app/api/admin/trip-pass/refunds/refund-route";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  operatorMutationVerificationConfig,
  readOperatorAccountAllowlist,
} from "@/server/operations/operator-auth";

export async function POST(request: Request) {
  return postOperatorRefundResponse(request, {
    allowlist: readOperatorAccountAllowlist(),
    auth: async () => {
      const snapshot = await auth();
      return {
        accountId: snapshot.userId,
        mfaFresh: snapshot.has({ reverification: operatorMutationVerificationConfig }),
      };
    },
    db: getDefaultDatabaseQueryClient(),
    reverificationResponse: () => reverificationErrorResponse(operatorMutationVerificationConfig),
  });
}
