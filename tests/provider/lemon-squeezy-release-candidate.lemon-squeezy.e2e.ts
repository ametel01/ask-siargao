import { createHmac, randomUUID } from "node:crypto";

import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, type Frame, type Page, test } from "@playwright/test";
import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import {
  createLemonSqueezyHttpClient,
  type LemonSqueezyOrder,
  type NormalizedPaymentFact,
} from "@/server/payments/lemon-squeezy";
import { verifyProtectedLemonSqueezyCatalog } from "@/server/qa/lemon-squeezy-release-candidate";
import { providerReleaseCandidateCheckoutExpiryMatches } from "@/server/qa/provider-release-candidate";
import { createLiveProtectedProviderHarness } from "@/server/qa/provider-release-candidate-live-boundary";
import { providerReleaseCandidateDiskFiles } from "@/server/qa/provider-release-candidate-receipts";
import {
  createLemonSqueezyCheckoutClient,
  type LemonSqueezyCheckoutOrderSnapshot,
  summarizeCheckout,
} from "@/server/trip-pass/lemon-squeezy-adapter";

test.describe.configure({ mode: "serial" });

const providerHarness = await createLiveProtectedProviderHarness("lemon-squeezy");
const {
  authorizePage: authorizeProtectedPage,
  providerCall: safeProviderCall,
  recordScenarios,
  requiredEnvironment,
  revalidate: assertApplicationBoundary,
} = providerHarness;
const lemonHttp = createLemonSqueezyHttpClient();
const lemonClient = createLemonSqueezyCheckoutClient(lemonHttp);
const origin = new URL(requiredEnvironment("PROVIDER_RC_APP_ORIGIN")).origin;
const recoveryReceiptPath = `.tmp/provider-release-candidate/lemon-squeezy-${requiredEnvironment(
  "PROVIDER_RC_EXPECTED_SHA",
)}.recovery.jsonl`;

test.beforeEach(async ({ page }) => {
  await authorizeProtectedPage(page);
});

test("checkout, return-before-webhook, signed duplicate facts, settlement, and refunds", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_LEMON_SQUEEZY_ACTIVE_USER");
  await assertLiveBoundary(page);

  const checkout = await startCheckout(page);
  const retry = await startCheckout(page);
  safeAssert(retry.checkoutUrl === checkout.checkoutUrl, "Checkout retry did not reuse one URL.");
  safeAssert(retry.order.id === checkout.order.id, "Checkout retry changed the local Order.");
  const providerCheckout = await retrieveCheckout(checkout.order.provider_checkout_id);
  expect(providerCheckout).toMatchObject({
    orderId: checkout.order.id,
    storeId: requiredEnvironment("LEMON_SQUEEZY_STORE_ID"),
    testMode: true,
    variantId: requiredEnvironment("LEMON_SQUEEZY_VARIANT_ID"),
  });
  assertThirtyMinuteExpiryBoundary(checkout.order, providerCheckout.expiresAt);
  await recordScenarios([
    "test_mode_checkout_creation",
    "checkout_correlation",
    "thirty_minute_expiry_boundary",
  ]);

  const providerReturn = await completeLemonSqueezyTestCheckout(page, checkout);
  const returnResponse = await page.request.post("/api/me/trip-pass/checkout/return", {
    data: {
      orderId: checkout.order.id,
      providerOrderId: providerReturn.providerOrderId,
      providerOrderIdentifier: providerReturn.providerOrderIdentifier,
    },
    headers: { origin },
  });
  expect(returnResponse.status()).toBe(202);
  await expectTripPassStatus(page, "pending");

  const paid = await retrieveOrder(providerReturn.providerOrderId);
  expect(paid).toMatchObject({
    orderId: checkout.order.id,
    status: "paid",
    testMode: true,
  });
  const paidPayload = paymentPayload(paid, "order_created");
  expect(await deliverSignedLemonSqueezyEvent(page, paidPayload)).toMatchObject({
    status: 200,
    inboxStatus: "applied",
  });
  expect(await deliverSignedLemonSqueezyEvent(page, paidPayload)).toMatchObject({
    status: 200,
    inboxStatus: "duplicate",
  });
  await expectTripPassStatus(page, "active");
  await recordScenarios([
    "return_before_webhook_convergence",
    "signed_webhook_ingestion",
    "duplicate_payment_fact",
  ]);

  const before = await chatAllowance(page);
  const chat = await page.request.post("/api/chat", {
    data: { messages: [{ role: "user", content: "Name one quiet Siargao activity." }] },
    headers: { "idempotency-key": randomUUID(), origin },
  });
  expect(chat.status()).toBe(200);
  const after = await chatAllowance(page);
  expect(after.used).toBe(before.used + 1);
  await recordScenarios(["paid_answer_settlement"]);

  await assertLiveBoundary(page);
  const total = requiredAmount(paid);
  const partialAmount = Math.floor(total / 2);
  const partial = await safeProviderCall("issue partial test refund", () =>
    lemonClient.refundOrder(paid.providerOrderId, {
      amountMinor: partialAmount,
      idempotencyKey: `provider-rc-partial:${checkout.order.id}`,
    }),
  );
  await deliverSignedLemonSqueezyEvent(page, paymentPayload(partial, "order_refunded"));
  await expectTripPassStatus(page, "refund_review");
  await recordScenarios(["partial_refund"]);

  const full = await safeProviderCall("complete test refund", () =>
    lemonClient.refundOrder(paid.providerOrderId, {
      amountMinor: total - partialAmount,
      idempotencyKey: `provider-rc-full:${checkout.order.id}`,
    }),
  );
  await deliverSignedLemonSqueezyEvent(page, paymentPayload(full, "order_refunded"));
  await expectTripPassStatus(page, "revoked");
  await recordScenarios(["full_refund"]);
});

test("a second provider payment creates durable refund recovery", async ({ page }) => {
  await signIn(page, "PROVIDER_RC_LEMON_SQUEEZY_DUPLICATE_USER");
  await assertLiveBoundary(page);
  const checkout = await startCheckout(page);
  const firstReturn = await completeLemonSqueezyTestCheckout(page, checkout);
  const first = await retrieveOrder(firstReturn.providerOrderId);
  await deliverSignedLemonSqueezyEvent(page, paymentPayload(first, "order_created"));
  await expectTripPassStatus(page, "active");

  await assertLiveBoundary(page);
  const duplicateCheckout = await safeProviderCall("create duplicate-payment test Checkout", () =>
    lemonClient.createCheckout(
      {
        appUrl: origin,
        order: checkoutOrderSnapshot(
          checkout.order,
          requiredEnvironment("PROVIDER_RC_LEMON_SQUEEZY_DUPLICATE_USER"),
        ),
      },
      { idempotencyKey: `provider-rc-duplicate:${checkout.order.id}:${randomUUID()}` },
    ),
  );
  const duplicateReturn = await completeLemonSqueezyTestCheckout(page, {
    checkoutUrl: duplicateCheckout.url,
    order: checkout.order,
  });
  const duplicate = await retrieveOrder(duplicateReturn.providerOrderId);
  expect(
    await deliverSignedLemonSqueezyEvent(page, paymentPayload(duplicate, "order_created")),
  ).toMatchObject({
    status: 200,
    applicationResult: { action: "refunded" },
  });
  await expectRefundOperation(checkout.order.id, "duplicate_payment", "pending");
  await recordRecoveryOrder("duplicate_payment", checkout.order.id);
});

test("out-of-order and fraudulent facts converge through the signed inbox", async ({ page }) => {
  await signIn(page, "PROVIDER_RC_LEMON_SQUEEZY_FRAUD_USER");
  await assertLiveBoundary(page);
  const checkout = await startCheckout(page);
  const providerReturn = await completeLemonSqueezyTestCheckout(page, checkout);
  const paid = await retrieveOrder(providerReturn.providerOrderId);
  await deliverSignedLemonSqueezyEvent(page, paymentPayload(paid, "order_created"));
  await expectTripPassStatus(page, "active");

  const paidAt = new Date(paid.providerUpdatedAt).getTime();
  const fraudulent = paymentPayload(
    {
      ...paid,
      providerUpdatedAt: new Date(paidAt + 2 * 60_000).toISOString(),
      status: "fraudulent",
    },
    "order_created",
  );
  expect(await deliverSignedLemonSqueezyEvent(page, fraudulent)).toMatchObject({
    status: 200,
    inboxStatus: "applied",
    applicationResult: { action: "payment_suspended" },
  });
  const stalePaid = paymentPayload(
    { ...paid, providerUpdatedAt: new Date(paidAt + 60_000).toISOString() },
    "order_created",
  );
  expect(await deliverSignedLemonSqueezyEvent(page, stalePaid)).toMatchObject({
    status: 200,
    inboxStatus: "applied",
    applicationResult: { status: "duplicate" },
  });
  await expectTripPassStatus(page, "dispute_suspended");
  await recordScenarios(["out_of_order_payment_fact", "fraudulent_state"]);
});

test("closure race records Paid After Closure and durable Lemon Squeezy refund work", async ({
  page,
}) => {
  await signIn(page, "PROVIDER_RC_LEMON_SQUEEZY_CLOSURE_USER");
  await assertLiveBoundary(page);
  const checkout = await startCheckout(page);
  await closeAccount(page);
  await assertProviderCatalog();
  const providerReturn = await completeLemonSqueezyTestCheckout(page, checkout);
  const paid = await retrieveOrder(providerReturn.providerOrderId);
  await deliverSignedLemonSqueezyEvent(page, paymentPayload(paid, "order_created"));
  await expectRefundOperation(checkout.order.id, "paid_after_closure", "pending");
  await recordRecoveryOrder("paid_after_closure", checkout.order.id);
  await recordScenarios(["account_closure_race"]);
});

test("final live boundary follows refund recovery and reconciliation", async ({ page }) => {
  await signIn(page, "PROVIDER_RC_BOUNDARY_USER");
  await assertLiveBoundary(page);
  const recoveryOrders = await readRecoveryOrders();
  await expectRecovery("duplicate_payment", recoveryOrders.duplicate_payment);
  await expectRecovery("paid_after_closure", recoveryOrders.paid_after_closure);
  await expectReconciliation(recoveryOrders.duplicate_payment);
  await recordScenarios(["duplicate_payment_refund_recovery", "commerce_reconciliation"]);
  await providerHarness.seal(page);
});

type ProtectedOrder = {
  checkout_idempotency_key: string;
  checkout_session_expires_at: Date | string;
  created_at: Date | string;
  id: string;
  product_family: string;
  provider_checkout_id: string;
  provider_product_id: string;
  provider_store_id: string;
  provider_variant_id: string;
  user_id: string;
};

async function signIn(page: Page, emailName: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await safeProviderCall("protected Clerk sign-in", () =>
    clerk.signIn({ page, emailAddress: requiredEnvironment(emailName) }),
  );
  expect((await page.request.get("/api/me/profile")).status()).toBe(200);
}

async function startCheckout(page: Page) {
  const response = await page.request.post("/api/me/trip-pass/checkout", {
    headers: { origin },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { checkoutUrl?: string; status?: string };
  if (!body.checkoutUrl || !["started", "reused"].includes(body.status ?? "")) {
    throw new Error("The protected app did not return a payable Lemon Squeezy Checkout.");
  }
  const userId = await page.evaluate(() => window.Clerk.user?.id ?? null);
  if (!userId) throw new Error("The protected session has no authenticated user.");
  const order = await withDatabase(async (sql) => {
    const rows = await sql<ProtectedOrder[]>`
      select id, user_id, product_family, checkout_idempotency_key, created_at,
        checkout_session_expires_at, provider_checkout_id, provider_store_id,
        provider_product_id, provider_variant_id
      from trip_pass_orders
      where user_id = ${userId} and payment_provider = 'lemon_squeezy'
      order by created_at desc limit 1
    `;
    return rows[0];
  });
  if (!order?.provider_checkout_id) throw new Error("Protected Checkout correlation is missing.");
  return { checkoutUrl: body.checkoutUrl, order };
}

async function retrieveCheckout(providerCheckoutId: string) {
  const response = await safeProviderCall("retrieve exact test Checkout", () =>
    lemonHttp.request({
      method: "GET",
      path: `/v1/checkouts/${encodeURIComponent(providerCheckoutId)}`,
    }),
  );
  return summarizeCheckout(response);
}

async function retrieveOrder(providerOrderId: string) {
  return safeProviderCall("retrieve exact test Order", () =>
    lemonClient.retrieveOrder(providerOrderId),
  );
}

async function assertLiveBoundary(page: Page) {
  await assertApplicationBoundary(page);
  await assertProviderCatalog();
}

async function assertProviderCatalog() {
  await safeProviderCall("revalidate exact test catalogue", () =>
    verifyProtectedLemonSqueezyCatalog({
      expected: {
        productId: requiredEnvironment("LEMON_SQUEEZY_PRODUCT_ID"),
        storeId: requiredEnvironment("LEMON_SQUEEZY_STORE_ID"),
        variantId: requiredEnvironment("LEMON_SQUEEZY_VARIANT_ID"),
      },
      request: (path) => lemonHttp.request({ method: "GET", path }),
    }),
  );
}

function assertThirtyMinuteExpiryBoundary(
  order: ProtectedOrder,
  providerExpiresAt: Date | null | undefined,
) {
  if (!providerExpiresAt) throw new Error("Protected Checkout did not return an expiry.");
  const matches = providerReleaseCandidateCheckoutExpiryMatches({
    createdEpochSeconds: new Date(order.created_at).getTime() / 1_000,
    expiryEpochSeconds: new Date(order.checkout_session_expires_at).getTime() / 1_000,
    providerExpiryEpochSeconds: providerExpiresAt.getTime() / 1_000,
  });
  safeAssert(matches, "Checkout did not preserve the exact 30-minute expiry boundary.");
}

async function completeLemonSqueezyTestCheckout(
  page: Page,
  checkout: { checkoutUrl: string; order: ProtectedOrder },
) {
  await page.goto(checkout.checkoutUrl);
  await fillCheckoutField(page, ["input[autocomplete='name']", "input[name='name']"], "Test Buyer");
  await fillCheckoutField(
    page,
    ["input[autocomplete='cc-number']", "input[name='cardnumber']"],
    "4242424242424242",
  );
  await fillCheckoutField(page, ["input[autocomplete='cc-exp']", "input[name='exp-date']"], "1235");
  await fillCheckoutField(page, ["input[autocomplete='cc-csc']", "input[name='cvc']"], "123");
  const submit = page.getByRole("button", { name: /pay|buy|complete purchase/i }).last();
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL((url) => url.origin === origin && url.searchParams.has("provider_order"), {
    timeout: 120_000,
  });
  const url = new URL(page.url());
  const providerOrderId = url.searchParams.get("provider_order");
  const providerOrderIdentifier = url.searchParams.get("provider_identifier");
  if (!providerOrderId || !providerOrderIdentifier) {
    throw new Error("Lemon Squeezy return did not contain the bounded provider references.");
  }
  return { providerOrderId, providerOrderIdentifier };
}

async function fillCheckoutField(page: Page, selectors: string[], value: string) {
  await expect.poll(() => page.frames().length).toBeGreaterThan(0);
  for (const frame of page.frames()) {
    const candidate = await firstVisibleField(frame, selectors);
    if (candidate) {
      await candidate.fill(value);
      return;
    }
  }
  throw new Error("Protected Lemon Squeezy Checkout field was unavailable.");
}

async function firstVisibleField(frame: Frame, selectors: string[]) {
  for (const selector of selectors) {
    const field = frame.locator(selector).first();
    if (await field.isVisible().catch(() => false)) return field;
  }
  return undefined;
}

function paymentPayload(
  fact: NormalizedPaymentFact,
  eventName: "order_created" | "order_refunded",
) {
  return {
    meta: { event_name: eventName, custom_data: { order_id: fact.orderId } },
    data: {
      type: "orders",
      id: fact.providerOrderId,
      attributes: {
        currency: fact.currency,
        discount_total: fact.discountTotalMinor ?? 0,
        first_order_item: {
          product_id: fact.productId,
          test_mode: fact.testMode,
          variant_id: fact.variantId,
        },
        identifier: fact.paymentId,
        product_id: fact.productId,
        refunded: fact.status === "refunded",
        refunded_amount: fact.refundedAmountMinor ?? 0,
        status: fact.status,
        store_id: fact.storeId,
        test_mode: fact.testMode,
        total: fact.amountTotalMinor,
        updated_at: fact.providerUpdatedAt,
        variant_id: fact.variantId,
      },
    },
  };
}

async function deliverSignedLemonSqueezyEvent(page: Page, payload: object) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", requiredEnvironment("LEMON_SQUEEZY_WEBHOOK_SECRET"))
    .update(body)
    .digest("hex");
  const response = await page.request.post("/api/payments/lemon-squeezy/webhook", {
    data: body,
    headers: { "content-type": "application/json", "x-signature": signature },
  });
  const result = (await response.json()) as {
    applicationResult?: unknown;
    inboxStatus?: string;
    reason?: string;
  };
  return { ...result, status: response.status() };
}

function checkoutOrderSnapshot(
  order: ProtectedOrder,
  customerEmail: string,
): LemonSqueezyCheckoutOrderSnapshot {
  return {
    checkoutIdempotencyKey: order.checkout_idempotency_key,
    checkoutSessionExpiresAt: new Date(order.checkout_session_expires_at),
    customerEmail,
    id: order.id,
    productFamily: order.product_family,
    productId: order.provider_product_id,
    storeId: order.provider_store_id,
    testMode: true,
    userId: order.user_id,
    variantId: order.provider_variant_id,
  };
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

async function expectRefundOperation(orderId: string, reason: string, status: string) {
  await withDatabase(async (sql) => {
    await expect
      .poll(async () => {
        const rows = await sql<{ status: string }[]>`
          select status from trip_pass_refund_operations
          where order_id = ${orderId} and reason = ${reason}
          order by created_at desc limit 1
        `;
        return rows[0]?.status;
      })
      .toBe(status);
  });
}

type RecoveryReason = "duplicate_payment" | "paid_after_closure";

async function recordRecoveryOrder(reason: RecoveryReason, orderId: string) {
  await providerReleaseCandidateDiskFiles.append(
    recoveryReceiptPath,
    `${JSON.stringify({ orderId, reason })}\n`,
  );
}

async function readRecoveryOrders() {
  const contents = await providerReleaseCandidateDiskFiles.read(recoveryReceiptPath);
  if (!contents) throw new Error("Protected recovery correlation receipt is missing.");
  const orders = new Map<RecoveryReason, string>();
  for (const line of contents.split("\n").filter(Boolean)) {
    const entry = JSON.parse(line) as { orderId?: unknown; reason?: unknown };
    if (
      (entry.reason !== "duplicate_payment" && entry.reason !== "paid_after_closure") ||
      typeof entry.orderId !== "string" ||
      !entry.orderId
    ) {
      throw new Error("Protected recovery correlation receipt is invalid.");
    }
    const previous = orders.get(entry.reason);
    if (previous && previous !== entry.orderId) {
      throw new Error("Protected recovery correlation receipt is ambiguous.");
    }
    orders.set(entry.reason, entry.orderId);
  }
  const duplicatePayment = orders.get("duplicate_payment");
  const paidAfterClosure = orders.get("paid_after_closure");
  if (!duplicatePayment || !paidAfterClosure) {
    throw new Error("Protected recovery correlation receipt is incomplete.");
  }
  return { duplicate_payment: duplicatePayment, paid_after_closure: paidAfterClosure };
}

async function expectRecovery(reason: RecoveryReason, orderId: string) {
  await withDatabase(async (sql) => {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from trip_pass_refund_operations
      where order_id = ${orderId} and reason = ${reason} and status = 'succeeded'
    `;
    expect(rows[0]?.count).toBe(1);
  });
}

async function expectReconciliation(orderId: string) {
  await withDatabase(async (sql) => {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from operational_worker_tasks
      where task_type = 'commerce_reconciliation' and status = 'succeeded'
        and substring(resource_ref from '^[^:]+:[^:]+:(.*)$') = ${orderId}
    `;
    expect(rows[0]?.count).toBe(1);
  });
}

async function withDatabase<T>(work: (sql: ReturnType<typeof postgres>) => Promise<T>) {
  const sql = postgres(requiredEnvironment("DATABASE_URL"), {
    ...createPostgresConnectionOptions("cli"),
    max: 1,
    prepare: false,
  });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

function requiredAmount(order: LemonSqueezyOrder) {
  if (!order.amountTotalMinor || order.amountTotalMinor < 2) {
    throw new Error("Protected Lemon Squeezy Order cannot exercise partial and full refunds.");
  }
  return order.amountTotalMinor;
}

function safeAssert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
