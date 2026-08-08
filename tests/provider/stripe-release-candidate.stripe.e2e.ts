import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import Stripe from "stripe";

import { STRIPE_API_VERSION } from "@/server/payments/stripe-event-inbox";
import { buildProviderReleaseCandidateStripeEvent } from "@/server/qa/provider-release-candidate";
import { recordExecutedProviderScenario } from "@/server/qa/provider-release-candidate-receipts";

test.describe.configure({ mode: "serial" });

const stripe = new Stripe(required("STRIPE_RESTRICTED_KEY"), {
  apiVersion: STRIPE_API_VERSION,
});
const origin = new URL(required("PROVIDER_RC_APP_ORIGIN")).origin;

test("app checkout, cancellation, return-before-event, activation, duplicate, settlement, and refunds", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_STRIPE_ACTIVE_USER");
  await assertExactDeployment(page);

  const first = await startCheckout(page);
  const retry = await startCheckout(page);
  expect(retry.checkoutUrl).toBe(first.checkoutUrl);
  await expectTripPassStatus(page, "pending");
  await page.goto("/settings?trip_pass_checkout=return");
  await expectTripPassStatus(page, "pending");

  const cancellation = await page.request.delete("/api/me/trip-pass/checkout", {
    headers: { origin },
  });
  expect(cancellation.status()).toBe(200);
  const expired = await stripe.checkout.sessions.retrieve(await latestCheckoutSessionId(page));
  expect(expired.status).toBe("expired");

  const payable = await startCheckout(page);
  await completeHostedCheckout(
    page,
    payable.checkoutUrl,
    required("PROVIDER_RC_STRIPE_ACTIVE_USER"),
  );
  const session = await retrieveLatestCheckout(page);
  expect(session.livemode).toBe(false);
  expect(session.payment_status).toBe("paid");
  await expectTripPassStatus(page, "pending");

  const completion = stripeEvent("checkout.session.completed", session);
  await deliverSignedStripeEvent(page, completion);
  await deliverSignedStripeEvent(page, completion);
  await expectTripPassStatus(page, "active");

  const before = await chatAllowance(page);
  const chat = await page.request.post("/api/chat", {
    data: { messages: [{ role: "user", content: "Name one quiet Siargao activity." }] },
    headers: { "idempotency-key": crypto.randomUUID(), origin },
  });
  expect(chat.status()).toBe(200);
  const after = await chatAllowance(page);
  expect(after.used).toBe(before.used + 1);

  const paymentIntentId = providerId(session.payment_intent);
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const amount = paymentIntent.amount_received;
  if (amount < 3) throw new Error("Protected Price cannot exercise ambiguous cumulative refunds.");
  await proveAmbiguousRefundRetry(page, paymentIntentId);
  const refundableAmount = amount - 1;
  const partial = await stripe.refunds.create({
    amount: Math.floor(refundableAmount / 2),
    payment_intent: paymentIntentId,
  });
  expect(
    await deliverSignedStripeEvent(page, stripeEvent("refund.created", partial)),
  ).toMatchObject({
    status: 200,
    semanticOrdering: "provider_lookup_completed_before_application_started",
  });
  await expectTripPassStatus(page, "refund_review");
  const remainder = await stripe.refunds.create({
    amount: refundableAmount - Math.floor(refundableAmount / 2),
    payment_intent: paymentIntentId,
  });
  expect(
    await deliverSignedStripeEvent(page, stripeEvent("refund.created", remainder)),
  ).toMatchObject({
    status: 200,
    semanticOrdering: "provider_lookup_completed_before_application_started",
  });
  await expectTripPassStatus(page, "revoked");
  await closeAccount(page);
  await recordScenarios([
    "card_checkout",
    "explicit_expiry",
    "return_before_event",
    "verified_activation",
    "duplicate_delivery",
    "ambiguous_retry",
    "authenticated_cancellation",
    "cumulative_refunds",
    "paid_answer_settlement",
  ]);
});

test("reversed delivery retries authoritative dispute lookup before app suspension", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_STRIPE_REVERSED_USER");
  const checkout = await startCheckout(page);
  await completeHostedCheckout(
    page,
    checkout.checkoutUrl,
    required("PROVIDER_RC_STRIPE_REVERSED_USER"),
    "4000000000000259",
  );
  const session = await retrieveLatestCheckout(page);
  const paymentIntentId = providerId(session.payment_intent);
  let dispute: Stripe.Dispute | undefined;
  await expect
    .poll(async () => {
      const disputes = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 1 });
      dispute = disputes.data[0];
      return Boolean(dispute);
    })
    .toBe(true);
  if (!dispute) throw new Error("The Stripe dispute test payment produced no dispute.");

  const premature = await deliverSignedStripeEvent(
    page,
    stripeEvent("charge.dispute.created", dispute),
    false,
  );
  expect(premature).toMatchObject({ status: 200, applicationStatus: "rejected" });
  await deliverSignedStripeEvent(page, stripeEvent("checkout.session.completed", session));
  expect(
    await deliverSignedStripeEvent(page, stripeEvent("charge.dispute.created", dispute)),
  ).toMatchObject({
    status: 200,
    semanticOrdering: "provider_lookup_completed_before_application_started",
  });
  await expectTripPassStatus(page, "dispute_suspended");
  await closeAccount(page);
  await recordScenarios(["reversed_delivery", "dispute"]);
});

test("closure race records Paid After Closure without access and leaves durable refund work", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_STRIPE_CLOSURE_USER");
  const checkout = await startCheckout(page);
  const paymentPage = await page.context().newPage();
  await paymentPage.goto(checkout.checkoutUrl);
  await closeAccount(page);
  await completeHostedCheckout(
    paymentPage,
    checkout.checkoutUrl,
    required("PROVIDER_RC_STRIPE_CLOSURE_USER"),
  );
  const session = await retrieveCheckoutForClosedAccount();
  await deliverSignedStripeEvent(paymentPage, stripeEvent("checkout.session.completed", session));
  await assertPaidAfterClosure(session.id);
  await recordScenarios(["closure_race", "paid_after_closure"]);
});

async function proveAmbiguousRefundRetry(page: Page, paymentIntentId: string) {
  const idempotencyKey = `provider-rc-ambiguous-${crypto.randomUUID()}`;
  const marker = crypto.randomUUID();
  const params: Stripe.RefundCreateParams = {
    amount: 1,
    metadata: { provider_rc_ambiguity: marker },
    payment_intent: paymentIntentId,
  };
  const upstreamClient = Stripe.createNodeHttpClient();
  let responseDropped = false;
  const ambiguityClient = {
    getClientName: () => "provider-rc-fault-proxy",
    async makeRequest(...args: Parameters<typeof upstreamClient.makeRequest>) {
      const response = await upstreamClient.makeRequest(...args);
      const [, , path, method] = args;
      if (!responseDropped && method === "POST" && path === "/v1/refunds") {
        responseDropped = true;
        const error = new Error("Controlled response loss after provider acceptance.");
        Object.assign(error, { code: "ECONNRESET" });
        throw error;
      }
      return response;
    },
  };
  const faultStripe = new Stripe(required("STRIPE_RESTRICTED_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    httpClient: ambiguityClient,
    maxNetworkRetries: 0,
  });

  await expect(faultStripe.refunds.create(params, { idempotencyKey })).rejects.toThrow();
  expect(responseDropped).toBe(true);
  const retried = await stripe.refunds.create(params, { idempotencyKey });
  const providerRefunds = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
  });
  const matching = providerRefunds.data.filter(
    (refund) => refund.metadata?.provider_rc_ambiguity === marker,
  );
  expect(matching).toHaveLength(1);
  expect(matching[0]?.id).toBe(retried.id);
  await deliverSignedStripeEvent(page, stripeEvent("refund.created", retried));
  await expectTripPassRefundedAmount(page, 1);
}

async function expectTripPassRefundedAmount(page: Page, amount: number) {
  const userId = await page.evaluate(() => window.Clerk.user?.id ?? null);
  if (!userId) throw new Error("The protected session has no authenticated user.");
  await withDatabase(async (sql) => {
    await expect
      .poll(async () => {
        const rows = await sql<{ successful_refund_amount_minor: number }[]>`
          select successful_refund_amount_minor
          from trip_pass_orders
          where user_id = ${userId}
          order by created_at desc
          limit 1
        `;
        return rows[0]?.successful_refund_amount_minor;
      })
      .toBe(amount);
  });
}

async function recordScenarios(scenarios: string[]) {
  for (const scenario of scenarios) {
    await recordExecutedProviderScenario({
      checkedOutCommitSha: required("PROVIDER_RC_EXPECTED_SHA"),
      lane: "stripe",
      scenario,
    });
  }
}

async function signIn(page: Page, emailName: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: required(emailName) });
  expect((await page.request.get("/api/me/profile")).status()).toBe(200);
}

async function assertExactDeployment(page: Page) {
  const response = await page.request.get("/api/me/provider-release-candidate");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { releaseCandidateSha?: string };
  expect(body.releaseCandidateSha).toBe(required("PROVIDER_RC_EXPECTED_SHA"));
}

async function startCheckout(page: Page) {
  const response = await page.request.post("/api/me/trip-pass/checkout", {
    headers: { origin },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { checkoutUrl?: string; status?: string };
  if (!body.checkoutUrl || !["started", "reused"].includes(body.status ?? "")) {
    throw new Error("The protected app did not return a payable checkout.");
  }
  return { checkoutUrl: body.checkoutUrl };
}

async function completeHostedCheckout(
  page: Page,
  checkoutUrl: string,
  email: string,
  cardNumber = "4242424242424242",
) {
  if (!page.url().startsWith(checkoutUrl)) await page.goto(checkoutUrl);
  const emailInput = page.getByLabel(/email/i);
  if (await emailInput.isVisible()) await emailInput.fill(email);
  await page.getByLabel(/card number/i).fill(cardNumber);
  await page.getByLabel(/expiration/i).fill("1234");
  await page.getByLabel(/security code|cvc/i).fill("123");
  const name = page.getByLabel(/name on card/i);
  if (await name.isVisible()) await name.fill("Protected Test User");
  await page.getByRole("checkbox", { name: /terms/i }).check();
  await page.getByRole("button", { name: /pay/i }).click();
  await page.waitForURL(new RegExp(`^${escapeRegExp(origin)}/settings`), { timeout: 60_000 });
}

async function retrieveLatestCheckout(page: Page) {
  return stripe.checkout.sessions.retrieve(await latestCheckoutSessionId(page), {
    expand: ["line_items", "payment_intent"],
  });
}

async function latestCheckoutSessionId(page: Page) {
  const userId = await page.evaluate(() => window.Clerk.user?.id ?? null);
  if (!userId) throw new Error("The protected session has no authenticated user.");
  return withDatabase(async (sql) => {
    const rows = await sql<{ stripe_checkout_session_id: string | null }[]>`
      select stripe_checkout_session_id
      from trip_pass_orders
      where user_id = ${userId}
      order by created_at desc
      limit 1
    `;
    const id = rows[0]?.stripe_checkout_session_id;
    if (!id) throw new Error("The app has no provider checkout reference.");
    return id;
  });
}

async function retrieveCheckoutForClosedAccount() {
  const sessionId = await withDatabase(async (sql) => {
    const rows = await sql<{ stripe_checkout_session_id: string }[]>`
      select stripe_checkout_session_id
      from trip_pass_orders
      where closure_tombstone_id is not null
        and status in ('checkout_created', 'pending')
      order by updated_at desc
      limit 1
    `;
    if (!rows[0]) throw new Error("No closure-race checkout remained for verification.");
    return rows[0].stripe_checkout_session_id;
  });
  return stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
}

async function deliverSignedStripeEvent(page: Page, event: Stripe.Event, success = true) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: required("STRIPE_WEBHOOK_SECRET"),
  });
  const response = await page.request.post("/api/stripe/webhook", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
  if (success) expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    applicationStatus?: string;
    semanticOrdering?: string;
  };
  return {
    applicationStatus: body.applicationStatus,
    semanticOrdering: body.semanticOrdering,
    status: response.status(),
  };
}

function stripeEvent(
  type: Parameters<typeof buildProviderReleaseCandidateStripeEvent>[0]["type"],
  object: object,
): Stripe.Event {
  return buildProviderReleaseCandidateStripeEvent({
    eventId: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
    object,
    type,
  });
}

async function expectTripPassStatus(page: Page, status: string) {
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/me/trip-pass");
      if (response.status() !== 200) return "unavailable";
      return ((await response.json()) as { status?: string }).status;
    })
    .toBe(status);
}

async function chatAllowance(page: Page) {
  const response = await page.request.get("/api/me/trip-pass");
  const body = (await response.json()) as {
    allowances?: Array<{ meterType: string; used: number }>;
  };
  const allowance = body.allowances?.find((item) => item.meterType === "chat_message");
  if (!allowance) throw new Error("The protected app did not expose a chat allowance.");
  return allowance;
}

async function closeAccount(page: Page) {
  await page.goto("/settings#privacy");
  await page.getByRole("button", { name: "Close Account", exact: true }).click();
  await page.getByLabel("Account Closure confirmation").fill("CLOSE MY ACCOUNT");
  await page.getByRole("button", { name: "Close Account permanently" }).click();
  await expect.poll(async () => (await page.request.get("/api/me/profile")).status()).toBe(401);
}

async function assertPaidAfterClosure(sessionId: string) {
  await withDatabase(async (sql) => {
    await expect
      .poll(async () => {
        const rows = await sql<{ converged: boolean }[]>`
          select exists (
            select 1
            from trip_pass_orders o
            join account_closure_refund_obligations r on r.order_id = o.id
            where o.stripe_checkout_session_id = ${sessionId}
              and o.closure_outcome = 'paid_after_closure'
              and r.status = 'pending'
          ) as converged
        `;
        return rows[0]?.converged ?? false;
      })
      .toBe(true);
  });
}

async function withDatabase<T>(work: (sql: ReturnType<typeof postgres>) => Promise<T>) {
  const sql = postgres(required("DATABASE_URL"), { max: 1, prepare: false });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

function providerId(value: string | { id: string } | null) {
  const id = typeof value === "string" ? value : value?.id;
  if (!id) throw new Error("Stripe did not return the expected provider reference.");
  return id;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the protected Stripe lane.`);
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
