import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import Stripe from "stripe";

import { STRIPE_API_VERSION } from "@/server/payments/stripe-event-inbox";
import {
  buildProviderReleaseCandidateStripeEvent,
  providerReleaseCandidateCheckoutExpiryMatches,
} from "@/server/qa/provider-release-candidate";
import { createLiveProtectedProviderHarness } from "@/server/qa/provider-release-candidate-live-boundary";

test.describe.configure({ mode: "serial" });

const providerHarness = await createLiveProtectedProviderHarness("stripe");
const {
  providerCall: safeProviderCall,
  recordScenarios,
  requiredEnvironment,
  revalidate: assertLiveBoundary,
} = providerHarness;
const stripe = new Stripe(requiredEnvironment("STRIPE_RESTRICTED_KEY"), {
  apiVersion: STRIPE_API_VERSION,
});
const origin = new URL(requiredEnvironment("PROVIDER_RC_APP_ORIGIN")).origin;

test("app checkout, cancellation, return-before-event, activation, duplicate, settlement, and refunds", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_STRIPE_ACTIVE_USER");
  await assertLiveBoundary(page);

  const first = await startCheckout(page);
  const retry = await startCheckout(page);
  safeAssert(retry.checkoutUrl === first.checkoutUrl, "Checkout retry did not reuse one Session.");
  await assertThirtyMinuteExpiryBoundary(page);
  await recordScenarios(["thirty_minute_expiry_boundary"]);
  await expectTripPassStatus(page, "pending");
  await page.goto("/settings?trip_pass_checkout=return");
  await expectTripPassStatus(page, "pending");

  await assertLiveBoundary(page);
  const cancellation = await page.request.delete("/api/me/trip-pass/checkout", {
    headers: { origin },
  });
  expect(cancellation.status()).toBe(200);
  const expired = await safeProviderCall("retrieve cancelled Checkout", () =>
    latestCheckoutSessionId(page).then((id) => stripe.checkout.sessions.retrieve(id)),
  );
  expect(expired.status).toBe("expired");
  await recordScenarios(["authenticated_cancellation"]);

  await assertLiveBoundary(page);
  const payable = await startCheckout(page);
  await completeHostedCheckout(
    page,
    payable.checkoutUrl,
    requiredEnvironment("PROVIDER_RC_STRIPE_ACTIVE_USER"),
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
  const paymentIntent = await safeProviderCall("retrieve paid PaymentIntent", () =>
    stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }),
  );
  const amount = paymentIntent.amount_received;
  if (amount < 3) throw new Error("Protected Price cannot exercise ambiguous cumulative refunds.");
  await assertLiveBoundary(page);
  await proveAmbiguousRefundRetry(page, paymentIntentId);
  const refundableAmount = amount - 1;
  const partial = await safeProviderCall("create partial test refund", () =>
    stripe.refunds.create({
      amount: Math.floor(refundableAmount / 2),
      payment_intent: paymentIntentId,
    }),
  );
  expect(
    await deliverSignedStripeEvent(page, stripeEvent("refund.created", partial)),
  ).toMatchObject({
    status: 200,
    semanticOrdering: "provider_lookup_completed_before_application_started",
  });
  await expectTripPassStatus(page, "refund_review");
  const remainder = await safeProviderCall("create final test refund", () =>
    stripe.refunds.create({
      amount: refundableAmount - Math.floor(refundableAmount / 2),
      payment_intent: paymentIntentId,
    }),
  );
  expect(
    await deliverSignedStripeEvent(page, stripeEvent("refund.created", remainder)),
  ).toMatchObject({
    status: 200,
    semanticOrdering: "provider_lookup_completed_before_application_started",
  });
  await expectTripPassStatus(page, "revoked");
  await assertLiveBoundary(page);
  await closeAccount(page);
  await recordScenarios([
    "card_checkout",
    "return_before_event",
    "verified_activation",
    "duplicate_delivery",
    "ambiguous_retry",
    "cumulative_refunds",
    "paid_answer_settlement",
  ]);
});

test("reversed delivery retries authoritative dispute lookup before app suspension", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_STRIPE_REVERSED_USER");
  await assertLiveBoundary(page);
  const checkout = await startCheckout(page);
  await completeHostedCheckout(
    page,
    checkout.checkoutUrl,
    requiredEnvironment("PROVIDER_RC_STRIPE_REVERSED_USER"),
    "4000000000000259",
  );
  const session = await retrieveLatestCheckout(page);
  const paymentIntentId = providerId(session.payment_intent);
  let dispute: Stripe.Dispute | undefined;
  await expect
    .poll(async () => {
      const disputes = await safeProviderCall("list test disputes", () =>
        stripe.disputes.list({ payment_intent: paymentIntentId, limit: 1 }),
      );
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
  await assertLiveBoundary(page);
  await closeAccount(page);
  await recordScenarios(["reversed_delivery", "dispute"]);
});

test("closure race records Paid After Closure without access and leaves durable refund work", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_STRIPE_CLOSURE_USER");
  await assertLiveBoundary(page);
  const checkout = await startCheckout(page);
  const paymentPage = await page.context().newPage();
  await safeProviderCall("open hosted Checkout before closure", () =>
    paymentPage.goto(checkout.checkoutUrl),
  );
  await closeAccount(page);
  await completeHostedCheckout(
    paymentPage,
    checkout.checkoutUrl,
    requiredEnvironment("PROVIDER_RC_STRIPE_CLOSURE_USER"),
  );
  const session = await retrieveCheckoutForClosedAccount();
  await deliverSignedStripeEvent(paymentPage, stripeEvent("checkout.session.completed", session));
  await assertPaidAfterClosure(session.id);
  await recordScenarios(["closure_race", "paid_after_closure"]);
});

test("final live boundary matches immediately before Stripe evidence", async ({ page }) => {
  await signIn(page, "PROVIDER_RC_BOUNDARY_USER");
  await providerHarness.seal(page);
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
  const faultStripe = new Stripe(requiredEnvironment("STRIPE_RESTRICTED_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    httpClient: ambiguityClient,
    maxNetworkRetries: 0,
  });

  let firstResponseLost = false;
  try {
    await faultStripe.refunds.create(params, { idempotencyKey });
  } catch {
    firstResponseLost = true;
  }
  safeAssert(firstResponseLost && responseDropped, "Controlled Stripe ambiguity was not induced.");
  const retried = await safeProviderCall("retry ambiguous test refund", () =>
    stripe.refunds.create(params, { idempotencyKey }),
  );
  const providerRefunds = await safeProviderCall("list ambiguous test refunds", () =>
    stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 }),
  );
  const matching = providerRefunds.data.filter(
    (refund) => refund.metadata?.provider_rc_ambiguity === marker,
  );
  safeAssert(
    matching.length === 1 && matching[0]?.id === retried.id,
    "Ambiguous retry did not converge to one provider refund.",
  );
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

async function signIn(page: Page, emailName: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await safeProviderCall("protected Clerk sign-in", () =>
    clerk.signIn({ page, emailAddress: requiredEnvironment(emailName) }),
  );
  expect((await page.request.get("/api/me/profile")).status()).toBe(200);
}

async function assertThirtyMinuteExpiryBoundary(page: Page) {
  const session = await retrieveLatestCheckout(page);
  const userId = await page.evaluate(() => window.Clerk.user?.id ?? null);
  if (!userId) throw new Error("The protected session has no authenticated user.");
  const boundaryMatches = await withDatabase(async (sql) => {
    const rows = await sql<
      {
        created_epoch_seconds: number;
        expiry_epoch_seconds: number;
      }[]
    >`
      select
        extract(epoch from created_at)::double precision as created_epoch_seconds,
        extract(epoch from checkout_session_expires_at)::double precision as expiry_epoch_seconds
      from trip_pass_orders
      where user_id = ${userId}
      order by created_at desc
      limit 1
    `;
    const row = rows[0];
    return Boolean(
      row &&
        providerReleaseCandidateCheckoutExpiryMatches({
          createdEpochSeconds: row.created_epoch_seconds,
          expiryEpochSeconds: row.expiry_epoch_seconds,
          providerExpiryEpochSeconds: session.expires_at,
        }) &&
        session.expires_at > session.created,
    );
  });
  safeAssert(
    boundaryMatches,
    "Checkout did not preserve the database-authoritative 30-minute expiry boundary.",
  );
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
  await safeProviderCall("complete hosted test Checkout", async () => {
    if (!page.url().startsWith(checkoutUrl)) await page.goto(checkoutUrl);
    const emailInput = page.getByLabel(/email/i);
    if (await emailInput.isVisible()) await emailInput.fill(email);
    const cardNumberInput = page.getByLabel(/card number/i);
    if (!(await cardNumberInput.isVisible())) {
      const cardPaymentMethod = page
        .locator("#payment-method-label-card")
        .locator('xpath=ancestor::div[contains(@class, "AccordionItemHeader--clickable")]');
      await cardPaymentMethod.waitFor({ state: "visible" });
      await cardPaymentMethod.click();
    }
    await cardNumberInput.waitFor({ state: "visible" });
    await cardNumberInput.fill(cardNumber);
    await page.getByLabel(/expiration/i).fill("1234");
    await page.locator('input[name="cardCvc"]').fill("123");
    const name = page.getByLabel(/name on card/i);
    if (await name.isVisible()) await name.fill("Protected Test User");
    await page.getByRole("checkbox", { name: /terms/i }).check();
    await page.locator('[data-testid="hosted-payment-submit-button"]').click();
    await page.waitForURL(new RegExp(`^${escapeRegExp(origin)}/settings`), { timeout: 60_000 });
  });
}

async function retrieveLatestCheckout(page: Page) {
  return safeProviderCall("retrieve latest test Checkout", async () =>
    stripe.checkout.sessions.retrieve(await latestCheckoutSessionId(page), {
      expand: ["line_items", "payment_intent"],
    }),
  );
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
  return safeProviderCall("retrieve closed-account Checkout", () =>
    stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] }),
  );
}

async function deliverSignedStripeEvent(page: Page, event: Stripe.Event, success = true) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: requiredEnvironment("STRIPE_WEBHOOK_SECRET"),
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
  await expect
    .poll(async () => {
      const status = (await page.request.get("/api/me/profile")).status();
      return status === 401 || status === 404;
    })
    .toBe(true);
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
  const sql = postgres(requiredEnvironment("DATABASE_URL"), { max: 1, prepare: false });
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

function safeAssert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
