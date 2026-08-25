import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";

import { postRevokeFieldDeviceResponse } from "@/app/api/operator/field/devices/[deviceId]/revoke/revoke-route";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  fieldResearcherVerificationConfig,
  readFieldResearcherAccountAllowlist,
} from "@/server/field-security/authorization";

export async function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  const snapshot = await auth();
  if (!snapshot.has({ reverification: fieldResearcherVerificationConfig })) {
    return reverificationErrorResponse(fieldResearcherVerificationConfig);
  }
  const { deviceId } = await context.params;
  return postRevokeFieldDeviceResponse(request, deviceId, {
    allowlist: readFieldResearcherAccountAllowlist(),
    auth: async () => ({ accountId: snapshot.userId, mfaFresh: true }),
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
  });
}
