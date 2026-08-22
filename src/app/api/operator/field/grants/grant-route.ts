import { z } from "zod";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { FieldResearcherAuthSnapshot } from "@/server/field-security/authorization";
import {
  type FieldGrantSigningConfig,
  issueOfflineFieldGrant,
  issueOfflineFieldGrantSchema,
  offlineFieldGrantPolicy,
} from "@/server/field-security/grant-service";
import {
  authorizeFieldRequest,
  fieldJson,
  safeFieldRouteError,
} from "@/server/field-security/http";

export type FieldGrantRouteDependencies = {
  allowlist: ReadonlySet<string>;
  auth: () => Promise<FieldResearcherAuthSnapshot>;
  db: DatabaseQueryClient;
  now: () => Date;
  signing: () => FieldGrantSigningConfig;
};

export async function postFieldGrantResponse(
  request: Request,
  dependencies: FieldGrantRouteDependencies,
) {
  const authorization = authorizeFieldRequest({
    allowlist: dependencies.allowlist,
    auth: await dependencies.auth(),
    mutation: true,
    request,
  });
  if (authorization instanceof Response) return authorization;
  const parsed = issueOfflineFieldGrantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fieldJson({ error: "invalid_field_grant_request" }, 400);
  try {
    const result = await issueOfflineFieldGrant({
      accountId: authorization.accountId,
      db: dependencies.db,
      now: dependencies.now(),
      request: parsed.data,
      signing: dependencies.signing(),
    });
    return fieldJson({ ...result, policy: offlineFieldGrantPolicy() }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fieldJson({ error: "invalid_field_grant_request" }, 400);
    }
    const safe = safeFieldRouteError(error);
    return fieldJson({ error: safe.code }, safe.status);
  }
}
