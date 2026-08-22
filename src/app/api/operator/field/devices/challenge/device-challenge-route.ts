import { generateRegistrationOptions } from "@simplewebauthn/server";

import type { FieldResearcherAuthSnapshot } from "@/server/field-security/authorization";
import { authorizeFieldRequest, fieldJson } from "@/server/field-security/http";
import {
  createFieldRegistrationChallenge,
  fieldRegistrationChallengeCookie,
} from "@/server/field-security/registration-challenge";

export type FieldDeviceChallengeDependencies = {
  allowlist: ReadonlySet<string>;
  auth: () => Promise<FieldResearcherAuthSnapshot>;
  challengeSecret: string;
  now: () => Date;
  rpId: string;
};

export async function postFieldDeviceChallengeResponse(
  request: Request,
  dependencies: FieldDeviceChallengeDependencies,
) {
  const authorization = authorizeFieldRequest({
    allowlist: dependencies.allowlist,
    auth: await dependencies.auth(),
    mutation: true,
    request,
  });
  if (authorization instanceof Response) return authorization;
  try {
    const issued = createFieldRegistrationChallenge({
      accountId: authorization.accountId,
      nowMs: dependencies.now().getTime(),
      secret: dependencies.challengeSecret,
    });
    const options = await generateRegistrationOptions({
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      challenge: issued.challenge,
      rpID: dependencies.rpId,
      rpName: "Ask Siargao Field Workspace",
      supportedAlgorithmIDs: [-7],
      timeout: 5 * 60 * 1_000,
      userID: new TextEncoder().encode(authorization.accountId),
      userName: "Field Researcher",
    });
    return fieldJson({ options }, 200, {
      "set-cookie": `${fieldRegistrationChallengeCookie}=${issued.token}; HttpOnly; Path=/api/operator/field/devices; SameSite=Strict; Secure; Max-Age=600`,
    });
  } catch {
    return fieldJson({ error: "field_registration_not_configured" }, 503);
  }
}
