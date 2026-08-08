import type { DatabaseQueryClient } from "@/server/db/query-client";
import { trackServerEvent } from "@/server/observability/events";
import { verifyStripeWebhookPayload } from "@/server/payments/stripe";
import {
  readBoundedStripeWebhookBody,
  receiveStripeWebhookEvent,
  StripeWebhookBodyTooLargeError,
} from "@/server/payments/stripe-event-inbox";
import { tripPassProductCode, tripPassProductVersion } from "@/server/trip-pass/catalog";
import {
  applyTripPassStripeEvent,
  type PreparedTripPassStripeEvent,
  prepareTripPassStripeEvent,
} from "@/server/trip-pass/webhook-application";

export type StripeWebhookRouteDependencies = {
  applyTripPassStripeEvent: typeof applyTripPassStripeEvent;
  prepareTripPassStripeEvent?: typeof prepareTripPassStripeEvent;
  stripeWebhookSecretFromEnv: typeof stripeWebhookSecretFromEnv;
  trackServerEvent: typeof trackServerEvent;
  verifyStripeWebhookPayload: typeof verifyStripeWebhookPayload;
  receiveStripeWebhookEvent: typeof receiveStripeWebhookEvent;
};

const defaultDependencies: StripeWebhookRouteDependencies = {
  applyTripPassStripeEvent,
  prepareTripPassStripeEvent,
  stripeWebhookSecretFromEnv,
  trackServerEvent,
  verifyStripeWebhookPayload,
  receiveStripeWebhookEvent,
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
  options: { db?: DatabaseQueryClient; preparedEvent?: PreparedTripPassStripeEvent } = {},
) {
  const tripPassResult = await dependencies.applyTripPassStripeEvent(event, {
    db: options.db,
    preparedEvent: options.preparedEvent,
  });
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
        status: tripPassResult.status,
        applicationStatus: tripPassResult.status,
        action: "action" in tripPassResult ? tripPassResult.action : undefined,
        orderId: "orderId" in tripPassResult ? tripPassResult.orderId : undefined,
        stripeEventId: "stripeEventId" in tripPassResult ? tripPassResult.stripeEventId : event.id,
        reason: "reason" in tripPassResult ? tripPassResult.reason : undefined,
        semanticOrdering:
          options.preparedEvent?.kind === "refund" || options.preparedEvent?.kind === "dispute"
            ? options.preparedEvent.semanticOrdering
            : undefined,
      },
      { status: tripPassResult.status === "rejected" ? 400 : 200 },
    );
  }

  return Response.json({
    received: true,
    ignored: true,
    status: "noop",
    applicationStatus: "noop",
    reason: "legacy_audit_checkout_closed",
    stripeEventId: event.id,
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
    const payload = await readBoundedStripeWebhookBody(request);
    const event = await dependencies.verifyStripeWebhookPayload({
      payload,
      signature,
      webhookSecret: dependencies.stripeWebhookSecretFromEnv(),
    });
    const prepareEvent = dependencies.prepareTripPassStripeEvent;
    const inboxResult = await dependencies.receiveStripeWebhookEvent<PreparedTripPassStripeEvent>(
      event,
      {
        prepareEvent,
        applyEvent: async (preparedEvent, applicationOptions) => {
          const receivedEvent = prepareEvent ? preparedEvent.event : (preparedEvent as never);
          const response = await stripeWebhookResponseFromEvent(receivedEvent, dependencies, {
            db: applicationOptions.db,
            preparedEvent: prepareEvent ? preparedEvent : undefined,
          });
          return response.json();
        },
      },
    );

    if (
      inboxResult.status === "applied" &&
      typeof inboxResult.applicationResult === "object" &&
      inboxResult.applicationResult !== null
    ) {
      return Response.json(inboxResult.applicationResult);
    }

    return Response.json({
      received: true,
      inboxStatus: inboxResult.status,
      stripeEventId: inboxResult.stripeEventId,
      inboxId: inboxResult.inboxId,
      reason: "reason" in inboxResult ? inboxResult.reason : undefined,
    });
  } catch (error) {
    if (error instanceof StripeWebhookBodyTooLargeError) {
      return Response.json(
        {
          error: "stripe_webhook_body_too_large",
          message: "Webhook payload exceeds the configured size limit.",
        },
        { status: 413 },
      );
    }
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
