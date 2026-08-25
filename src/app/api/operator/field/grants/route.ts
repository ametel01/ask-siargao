import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";

import { postFieldGrantResponse } from "@/app/api/operator/field/grants/grant-route";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  fieldResearcherVerificationConfig,
  readFieldResearcherAccountAllowlist,
} from "@/server/field-security/authorization";
import { readFieldGrantSigningConfig } from "@/server/field-security/grant-service";

export async function POST(request: Request) {
  const snapshot = await auth();
  if (!snapshot.has({ reverification: fieldResearcherVerificationConfig })) {
    return reverificationErrorResponse(fieldResearcherVerificationConfig);
  }
  return postFieldGrantResponse(request, {
    allowlist: readFieldResearcherAccountAllowlist(),
    auth: async () => ({ accountId: snapshot.userId, mfaFresh: true }),
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
    signing: () => readFieldGrantSigningConfig(),
  });
}
