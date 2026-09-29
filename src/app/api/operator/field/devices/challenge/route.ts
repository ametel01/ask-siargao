import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";

import { postFieldDeviceChallengeResponse } from "@/app/api/operator/field/devices/challenge/device-challenge-route";
import {
  fieldResearcherVerificationConfig,
  readFieldResearcherAccountAllowlist,
} from "@/server/field-security/authorization";

export async function POST(request: Request) {
  const snapshot = await auth();
  if (!snapshot.has({ reverification: fieldResearcherVerificationConfig })) {
    return reverificationErrorResponse(fieldResearcherVerificationConfig);
  }
  return postFieldDeviceChallengeResponse(request, {
    allowlist: readFieldResearcherAccountAllowlist(),
    auth: async () => ({ accountId: snapshot.userId, mfaFresh: true }),
    challengeSecret: process.env.FIELD_WEBAUTHN_CHALLENGE_SECRET ?? "",
    now: () => new Date(),
    rpId: new URL(request.url).hostname,
  });
}
