import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";

import {
  getFieldDevicesResponse,
  postFieldDeviceResponse,
} from "@/app/api/operator/field/devices/device-route";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  fieldResearcherVerificationConfig,
  readFieldResearcherAccountAllowlist,
} from "@/server/field-security/authorization";

export async function GET(request: Request) {
  const snapshot = await auth();
  return getFieldDevicesResponse(request, {
    allowlist: readFieldResearcherAccountAllowlist(),
    auth: async () => ({ accountId: snapshot.userId, mfaFresh: false }),
    challengeSecret: process.env.FIELD_WEBAUTHN_CHALLENGE_SECRET ?? "",
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
  });
}

export async function POST(request: Request) {
  const snapshot = await auth();
  if (!snapshot.has({ reverification: fieldResearcherVerificationConfig })) {
    return reverificationErrorResponse(fieldResearcherVerificationConfig);
  }
  return postFieldDeviceResponse(request, {
    allowlist: readFieldResearcherAccountAllowlist(),
    auth: async () => ({ accountId: snapshot.userId, mfaFresh: true }),
    challengeSecret: process.env.FIELD_WEBAUTHN_CHALLENGE_SECRET ?? "",
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
  });
}
