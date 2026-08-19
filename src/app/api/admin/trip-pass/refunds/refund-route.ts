import { z } from "zod";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { OperatorAuthSnapshot } from "@/server/operations/operator-auth";
import {
  executeOperatorRefund,
  operatorRefundDecisions,
  previewOperatorRefund,
} from "@/server/operations/operator-refunds";

const decision = z.enum(operatorRefundDecisions);
const requestSchema = z.discriminatedUnion("mode", [
  z.strictObject({ decision, mode: z.literal("preview"), orderId: z.string().min(1).max(200) }),
  z.strictObject({
    confirmation: z.literal("APPLY REFUND"),
    decision,
    idempotencyKey: z.string().min(16).max(200),
    mode: z.literal("execute"),
    orderId: z.string().min(1).max(200),
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
    reasonCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  }),
]);

export type OperatorRefundRouteDependencies = {
  allowlist: ReadonlySet<string>;
  auth: () => Promise<OperatorAuthSnapshot>;
  db: DatabaseQueryClient;
  reverificationResponse?: () => Response;
};

export async function postOperatorRefundResponse(
  request: Request,
  dependencies: OperatorRefundRouteDependencies,
) {
  if (!allowedOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_operator_refund_request" }, 400);
  const auth = await dependencies.auth();
  try {
    if (parsed.data.mode === "preview") {
      const read = authorizeRead(auth, dependencies.allowlist);
      if (read) return json({ error: read }, 403);
      return json({ preview: await previewOperatorRefund(parsed.data, dependencies.db) });
    }
    const result = await executeOperatorRefund(
      { ...parsed.data, auth },
      { allowlist: dependencies.allowlist, db: dependencies.db },
    );
    if (result.status === "denied") {
      if (result.reason === "fresh_mfa_required" && dependencies.reverificationResponse) {
        return dependencies.reverificationResponse();
      }
      return json({ error: result.reason }, 403);
    }
    return json({ result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "operator_refund_failed";
    const safeCodes = new Set([
      "operator_refund_order_unavailable",
      "operator_refund_preview_changed",
      "operator_refund_idempotency_mismatch",
      "partial_refund_review_unavailable",
      "partial_refund_operation_in_flight",
      "refund_amount_unavailable",
      "refund_provider_terms_unavailable",
    ]);
    const safe = safeCodes.has(code) ? code : "operator_refund_failed";
    return json({ error: safe }, safe.includes("changed") || safe.includes("mismatch") ? 409 : 400);
  }
}

function authorizeRead(auth: OperatorAuthSnapshot, allowlist: ReadonlySet<string>) {
  if (!auth.accountId) return "unauthenticated";
  return allowlist.has(auth.accountId) ? null : "operator_not_allowlisted";
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (!origin || origin === new URL(request.url).origin) &&
    (!fetchSite || fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none")
  );
}

function json(body: unknown, status = 200) {
  return Response.json(body, { headers: { "cache-control": "private, no-store" }, status });
}
