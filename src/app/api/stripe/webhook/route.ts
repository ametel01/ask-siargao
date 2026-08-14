import { stripeWebhookRouteHandler } from "@/app/api/stripe/webhook/webhook-route";

export const runtime = "nodejs";

export const POST = stripeWebhookRouteHandler;
