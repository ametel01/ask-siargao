import { trackServerEvent } from "@/server/observability/events";
import { applyVerifiedCheckoutPayment } from "@/server/payments/audit-payment-lifecycle";
import {
  extractVerifiedCheckoutPayment,
  verifyStripeWebhookPayload,
} from "@/server/payments/stripe";
import { tripPassProductCode, tripPassProductVersion } from "@/server/trip-pass/catalog";
import { applyTripPassStripeEvent } from "@/server/trip-pass/webhook-application";

export type StripeWebhookRouteDependencies = {
  applyVerifiedCheckoutPayment: typeof applyVerifiedCheckoutPayment;
  applyTripPassStripeEvent: typeof applyTripPassStripeEvent;
  stripeWebhookSecretFromEnv: typeof stripeWebhookSecretFromEnv;
  trackServerEvent: typeof trackServerEvent;
  verifyStripeWebhookPayload: typeof verifyStripeWebhookPayload;
};

const defaultDependencies: StripeWebhookRouteDependencies = {
  applyVerifiedCheckoutPayment,
  applyTripPassStripeEvent,
  stripeWebhookSecretFromEnv,
  trackServerEvent,
  verifyStripeWebhookPayload,
};

let testDependencies: StripeWebhookRouteDependencies | undefined;

type VerifiedWebhookEvent =
  ReturnType<typeof verifyStripeWebhookPayload> extends Promise<infer T> ? T : never;

export function stripeWebhookRouteDependenciesForRequest() {
  return testDependencies ?? defaultDependencies;
}

export async function withStripeWebhookRouteDependenciesForTest<T>(
  dependencies: StripeWebhookRouteDependencies,
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

export async function stripeWebhookResponseFromEvent(
  event: VerifiedWebhookEvent,
  dependencies: StripeWebhookRouteDependencies = defaultDependencies,
) {
  const tripPassResult = await dependencies.applyTripPassStripeEvent(event);
  if (tripPassResult.status !== "ignored") {
    dependencies.trackServerEvent({
      name: "trip_pass_stripe_event_applied",
      payload: {
        action: "action" in tripPassResult ? tripPassResult.action : undefined,
        stripeEventId: "stripeEventId" in tripPassResult ? tripPassResult.stripeEventId : event.id,
        eventType: event.type,
        applicationStatus: tripPassResult.status,
        orderId: "orderId" in tripPassResult ? tripPassResult.orderId : undefined,
      },
    });
    if (tripPassResult.status === "applied") {
      const eventName = tripPassEventNameForAppliedAction(tripPassResult.action);
      dependencies.trackServerEvent({
        name: eventName,
        payload: {
          action: tripPassResult.action,
          applicationStatus: tripPassResult.status,
          eventType: event.type,
          productCode: tripPassProductCode,
          productVersion: tripPassProductVersion,
          status: "completed",
        },
      });
      if (tripPassResult.action === "activated") {
        dependencies.trackServerEvent({
          name: "trip_pass_checkout_completed",
          payload: {
            action: tripPassResult.action,
            applicationStatus: tripPassResult.status,
            eventType: event.type,
            productCode: tripPassProductCode,
            productVersion: tripPassProductVersion,
            status: "completed",
          },
        });
      }
    }

    return Response.json(
      {
        received: true,
        product: "trip_pass",
        applicationStatus: tripPassResult.status,
        action: "action" in tripPassResult ? tripPassResult.action : undefined,
        orderId: "orderId" in tripPassResult ? tripPassResult.orderId : undefined,
        stripeEventId: "stripeEventId" in tripPassResult ? tripPassResult.stripeEventId : event.id,
        reason: "reason" in tripPassResult ? tripPassResult.reason : undefined,
      },
      { status: tripPassResult.status === "rejected" ? 400 : 200 },
    );
  }

  const payment = extractVerifiedCheckoutPayment(event);

  if (!payment) {
    return Response.json({ received: true, ignored: true });
  }

  const result = await dependencies.applyVerifiedCheckoutPayment(payment, event);

  dependencies.trackServerEvent({
    name: "payment_succeeded",
    payload: {
      auditRequestId: payment.auditRequestId,
      stripeEventId: payment.stripeEventId,
      eventType: payment.eventType,
      applicationStatus: result.status,
    },
  });

  return Response.json({
    received: true,
    applicationStatus: result.status,
    auditRequestId: payment.auditRequestId,
    stripeEventId: payment.stripeEventId,
    generationJobId: result.status === "applied" ? result.job.id : undefined,
  });
}

function tripPassEventNameForAppliedAction(
  action: Extract<
    Awaited<ReturnType<typeof applyTripPassStripeEvent>>,
    { status: "applied" }
  >["action"],
) {
  if (action === "activated") {
    return "trip_pass_activated";
  }
  if (action === "failed") {
    return "trip_pass_checkout_failed";
  }
  if (action === "expired") {
    return "trip_pass_expired";
  }
  if (action === "refunded") {
    return "trip_pass_refund_transition";
  }
  return "trip_pass_dispute_transition";
}

export async function stripeWebhookResponse(
  request: Request,
  dependencies: StripeWebhookRouteDependencies = defaultDependencies,
) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "missing_stripe_signature" }, { status: 400 });
  }

  try {
    const payload = await request.text();
    const event = await dependencies.verifyStripeWebhookPayload({
      payload,
      signature,
      webhookSecret: dependencies.stripeWebhookSecretFromEnv(),
    });
    return await stripeWebhookResponseFromEvent(event, dependencies);
  } catch {
    return Response.json(
      {
        error: "invalid_stripe_webhook",
        message: "Webhook verification failed.",
      },
      { status: 400 },
    );
  }
}

export function stripeWebhookSecretFromEnv() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required for webhook verification.");
  }

  return webhookSecret;
}
