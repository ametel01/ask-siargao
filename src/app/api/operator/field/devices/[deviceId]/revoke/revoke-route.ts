import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { FieldResearcherAuthSnapshot } from "@/server/field-security/authorization";
import { revokeFieldDevice } from "@/server/field-security/device-registry";
import {
  authorizeFieldRequest,
  fieldJson,
  safeFieldRouteError,
} from "@/server/field-security/http";

export type RevokeFieldDeviceDependencies = {
  allowlist: ReadonlySet<string>;
  auth: () => Promise<FieldResearcherAuthSnapshot>;
  db: DatabaseQueryClient;
  now: () => Date;
};

export async function postRevokeFieldDeviceResponse(
  request: Request,
  deviceId: string,
  dependencies: RevokeFieldDeviceDependencies,
) {
  const authorization = authorizeFieldRequest({
    allowlist: dependencies.allowlist,
    auth: await dependencies.auth(),
    mutation: true,
    request,
  });
  if (authorization instanceof Response) return authorization;
  if (!/^field_device_[A-Za-z0-9_-]{16,}$/u.test(deviceId)) {
    return fieldJson({ error: "invalid_field_device_request" }, 400);
  }
  try {
    return fieldJson({
      result: await revokeFieldDevice({
        accountId: authorization.accountId,
        db: dependencies.db,
        deviceId,
        now: dependencies.now(),
      }),
    });
  } catch (error) {
    const safe = safeFieldRouteError(error);
    return fieldJson({ error: safe.code }, safe.status);
  }
}
