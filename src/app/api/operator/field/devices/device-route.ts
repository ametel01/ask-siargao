import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { FieldResearcherAuthSnapshot } from "@/server/field-security/authorization";
import {
  listActiveFieldDevices,
  type RegisterFieldDeviceInput,
  registerFieldDevice,
} from "@/server/field-security/device-registry";
import {
  authorizeFieldRequest,
  fieldJson,
  safeFieldRouteError,
} from "@/server/field-security/http";
import {
  fieldRegistrationChallengeCookie,
  verifyFieldRegistrationChallenge,
} from "@/server/field-security/registration-challenge";

export type FieldDeviceRouteDependencies = {
  allowlist: ReadonlySet<string>;
  auth: () => Promise<FieldResearcherAuthSnapshot>;
  challengeSecret: string;
  db: DatabaseQueryClient;
  now: () => Date;
};

export async function getFieldDevicesResponse(
  request: Request,
  dependencies: FieldDeviceRouteDependencies,
) {
  const authorization = authorizeFieldRequest({
    allowlist: dependencies.allowlist,
    auth: await dependencies.auth(),
    mutation: false,
    request,
  });
  if (authorization instanceof Response) return authorization;
  try {
    return fieldJson({
      devices: await listActiveFieldDevices({
        accountId: authorization.accountId,
        db: dependencies.db,
      }),
    });
  } catch {
    return fieldJson({ error: "field_security_operation_failed" }, 500);
  }
}

export async function postFieldDeviceResponse(
  request: Request,
  dependencies: FieldDeviceRouteDependencies,
) {
  const authorization = authorizeFieldRequest({
    allowlist: dependencies.allowlist,
    auth: await dependencies.auth(),
    mutation: true,
    request,
  });
  if (authorization instanceof Response) return authorization;
  try {
    const token = readCookie(request.headers.get("cookie"), fieldRegistrationChallengeCookie);
    const challenge = verifyFieldRegistrationChallenge({
      accountId: authorization.accountId,
      nowMs: dependencies.now().getTime(),
      secret: dependencies.challengeSecret,
      token,
    });
    const device = await registerFieldDevice({
      accountId: authorization.accountId,
      challenge,
      db: dependencies.db,
      expectedOrigin: new URL(request.url).origin,
      expectedRpId: new URL(request.url).hostname,
      now: dependencies.now(),
      request: (await request.json()) as RegisterFieldDeviceInput,
    });
    return fieldJson({ device }, 201, {
      "set-cookie": `${fieldRegistrationChallengeCookie}=; HttpOnly; Path=/api/operator/field/devices; SameSite=Strict; Secure; Max-Age=0`,
    });
  } catch (error) {
    const safe = safeFieldRouteError(error);
    return fieldJson({ error: safe.code }, safe.status);
  }
}

function readCookie(header: string | null, name: string): string {
  const match = header
    ?.split(";")
    .map((entry) => entry.trim().split("="))
    .find(([key]) => key === name);
  if (!match?.[1]) throw new Error("field_registration_challenge_invalid");
  return match[1];
}
