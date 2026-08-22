import type { FieldResearcherAuthSnapshot } from "@/server/field-security/authorization";
import { authorizeFieldResearcher } from "@/server/field-security/authorization";
import { isAllowedMutationOrigin } from "@/server/security/request-origin";

export const fieldPrivateHeaders = { "cache-control": "private, no-store" } as const;

export function fieldJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    headers: { ...fieldPrivateHeaders, ...headers },
    status,
  });
}

export function authorizeFieldRequest(input: {
  allowlist: ReadonlySet<string>;
  auth: FieldResearcherAuthSnapshot;
  mutation: boolean;
  request: Request;
}): { accountId: string } | Response {
  if (input.mutation && !isAllowedMutationOrigin(input.request)) {
    return fieldJson({ error: "invalid_request_origin" }, 403);
  }
  const authorization = authorizeFieldResearcher(input);
  if (!authorization.allowed) {
    return fieldJson(
      { error: authorization.reason },
      authorization.reason === "unauthenticated" ? 401 : 403,
    );
  }
  return { accountId: authorization.accountId };
}

export function safeFieldRouteError(error: unknown): { code: string; status: number } {
  const code = error instanceof Error ? error.message : "field_security_operation_failed";
  const clientCodes = new Set([
    "field_device_key_fingerprint_invalid",
    "field_device_not_authorized",
    "field_device_not_found",
    "field_grant_duration_invalid",
    "field_protocol_incompatible",
    "field_registration_challenge_invalid",
    "field_unlock_credential_ineligible",
  ]);
  if (!clientCodes.has(code)) return { code: "field_security_operation_failed", status: 500 };
  return {
    code,
    status:
      code === "field_device_not_found" ? 404 : code === "field_device_not_authorized" ? 403 : 400,
  };
}
