import { z } from "zod";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { OperatorAuthSnapshot } from "@/server/operations/operator-auth";
import { authorizeOperator } from "@/server/operations/operator-auth";
import {
  executeRepairAction,
  previewRepairAction,
  type RepairActionDispatcher,
  type RepairActionType,
  repairActionTypes,
} from "@/server/operations/repair-actions";

const actionType = z.enum(repairActionTypes);
const requestSchema = z.discriminatedUnion("mode", [
  z.strictObject({ actionType, findingId: z.string().min(1).max(200), mode: z.literal("preview") }),
  z.strictObject({
    actionType,
    confirmation: z.literal("APPLY REPAIR"),
    findingId: z.string().min(1).max(200),
    idempotencyKey: z.string().min(16).max(200),
    mode: z.literal("execute"),
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
    reasonCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  }),
]);

export type RepairRouteDependencies = {
  allowlist: ReadonlySet<string>;
  auth: () => Promise<OperatorAuthSnapshot>;
  db: DatabaseQueryClient;
  executor: RepairActionDispatcher;
};

export async function postRepairResponse(request: Request, dependencies: RepairRouteDependencies) {
  if (!allowedOrigin(request)) {
    return json({ error: "invalid_request_origin" }, 403);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_repair_request" }, 400);
  const auth = await dependencies.auth();
  const readAuthorization = authorizeOperator({
    allowlist: dependencies.allowlist,
    auth,
    mutation: false,
  });
  if (!readAuthorization.allowed) return json({ error: readAuthorization.reason }, 403);

  try {
    if (parsed.data.mode === "preview") {
      const preview = await previewRepairAction(
        {
          actionType: parsed.data.actionType as RepairActionType,
          findingId: parsed.data.findingId,
        },
        { db: dependencies.db, executor: dependencies.executor },
      );
      return json({ preview });
    }
    const result = await executeRepairAction(
      { ...parsed.data, auth },
      {
        allowlist: dependencies.allowlist,
        db: dependencies.db,
        executor: dependencies.executor,
      },
    );
    if (result.status === "denied") return json({ error: result.reason }, 403);
    return json({ result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "repair_failed";
    const safe = new Set([
      "repair_finding_unavailable",
      "repair_preview_changed",
      "repair_idempotency_mismatch",
      "unsupported_repair_action_for_finding",
    ]).has(code)
      ? code
      : "repair_failed";
    return json(
      { error: safe },
      safe === "repair_preview_changed" || safe === "repair_idempotency_mismatch" ? 409 : 400,
    );
  }
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
