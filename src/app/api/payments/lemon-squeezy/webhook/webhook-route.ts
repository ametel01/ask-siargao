import type { DatabaseQueryClient } from "@/server/db/query-client";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  LemonSqueezyWebhookBodyTooLargeError,
  type lemonSqueezyWebhookSecretFromEnv,
  lemonSqueezyWebhookSecretsFromEnv,
  readBoundedLemonSqueezyWebhookBody,
  verifyLemonSqueezyWebhookSignature,
} from "@/server/payments/lemon-squeezy";
import {
  eventNameFromPayload,
  type PaymentEventReceiptResult,
  receiveLemonSqueezyPaymentEvent,
} from "@/server/payments/payment-event-receipts";
import { applyLemonSqueezyPaymentFact } from "@/server/trip-pass/lemon-squeezy-webhook-application";

export type LemonSqueezyWebhookRouteDependencies = {
  db: DatabaseQueryClient;
  secretFromEnv: typeof lemonSqueezyWebhookSecretFromEnv | typeof lemonSqueezyWebhookSecretsFromEnv;
  verifySignature: typeof verifyLemonSqueezyWebhookSignature;
  readBody: typeof readBoundedLemonSqueezyWebhookBody;
  receiveEvent: typeof receiveLemonSqueezyPaymentEvent;
  applyFact: typeof applyLemonSqueezyPaymentFact;
};

function defaultDependencies(): LemonSqueezyWebhookRouteDependencies {
  return {
    db: getDefaultDatabaseQueryClient(),
    secretFromEnv: lemonSqueezyWebhookSecretsFromEnv,
    verifySignature: verifyLemonSqueezyWebhookSignature,
    readBody: readBoundedLemonSqueezyWebhookBody,
    receiveEvent: receiveLemonSqueezyPaymentEvent,
    applyFact: applyLemonSqueezyPaymentFact,
  };
}

let testDependencies: LemonSqueezyWebhookRouteDependencies | undefined;

export async function lemonSqueezyWebhookResponse(request: Request) {
  return lemonSqueezyWebhookResponseWithDependencies(
    request,
    testDependencies ?? defaultDependencies(),
  );
}

export async function withLemonSqueezyWebhookRouteDependenciesForTest<T>(
  dependencies: LemonSqueezyWebhookRouteDependencies,
  work: () => Promise<T>,
) {
  const previous = testDependencies;
  testDependencies = dependencies;
  try {
    return await work();
  } finally {
    testDependencies = previous;
  }
}

export async function lemonSqueezyWebhookResponseWithDependencies(
  request: Request,
  dependencies: LemonSqueezyWebhookRouteDependencies,
) {
  const signature = request.headers.get("x-signature");
  if (!signature)
    return Response.json({ error: "missing_lemon_squeezy_signature" }, { status: 400 });

  try {
    const payload = await dependencies.readBody(request);
    const configuredSecrets = dependencies.secretFromEnv();
    const secrets = Array.isArray(configuredSecrets) ? configuredSecrets : [configuredSecrets];
    let verified = false;
    for (const secret of secrets) {
      try {
        dependencies.verifySignature({ payload, signature, webhookSecret: secret });
        verified = true;
        break;
      } catch {
        // Try the next bounded rotation secret.
      }
    }
    if (!verified) throw new Error("invalid_webhook_signature");
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return Response.json({ error: "invalid_lemon_squeezy_json" }, { status: 400 });
    }

    const eventName = eventNameFromPayload(parsed);
    const result = await dependencies.receiveEvent(parsed, {
      db: dependencies.db,
      eventName,
      applyFact: ({ fact, receiptId, db, now }) =>
        dependencies.applyFact(fact, { db, now, env: process.env }).then((applicationResult) => ({
          receiptId,
          applicationResult,
        })),
    });
    return responseForReceipt(result);
  } catch (error) {
    if (error instanceof LemonSqueezyWebhookBodyTooLargeError) {
      return Response.json({ error: "lemon_squeezy_webhook_body_too_large" }, { status: 413 });
    }
    return Response.json(
      { error: "invalid_lemon_squeezy_webhook", message: "Webhook verification failed." },
      { status: 400 },
    );
  }
}

function responseForReceipt(result: PaymentEventReceiptResult) {
  if (result.status === "applied") {
    const application = result.applicationResult as { applicationResult?: unknown };
    return Response.json({
      received: true,
      inboxStatus: result.status,
      receiptId: result.receiptId,
      fingerprint: result.fingerprint,
      applicationResult: application.applicationResult,
    });
  }
  return Response.json({
    received: true,
    inboxStatus: result.status,
    receiptId: result.receiptId,
    fingerprint: result.fingerprint,
    reason: "reason" in result ? result.reason : undefined,
  });
}
