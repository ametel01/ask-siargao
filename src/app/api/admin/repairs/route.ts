import { auth } from "@clerk/nextjs/server";

import { postRepairResponse } from "@/app/api/admin/repairs/repair-route";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  operatorMutationVerificationConfig,
  readOperatorAccountAllowlist,
} from "@/server/operations/operator-auth";
import { tripPassLocalRepairExecutor } from "@/server/operations/trip-pass-repair-executor";

export async function POST(request: Request) {
  return postRepairResponse(request, {
    allowlist: readOperatorAccountAllowlist(),
    auth: async () => {
      const snapshot = await auth();
      return {
        accountId: snapshot.userId,
        mfaFresh: snapshot.has({ reverification: operatorMutationVerificationConfig }),
      };
    },
    db: getDefaultDatabaseQueryClient(),
    executor: tripPassLocalRepairExecutor,
  });
}
