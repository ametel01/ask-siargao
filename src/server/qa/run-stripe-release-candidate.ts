import Stripe from "stripe";

import {
  assertProviderBeforeApplication,
  assertProviderReleaseCandidateContext,
} from "@/server/qa/provider-release-candidate";

const checkedOutCommitSha = await readHeadSha();
assertProviderReleaseCandidateContext({ checkedOutCommitSha, lane: "stripe" });

const key = process.env.STRIPE_RESTRICTED_KEY ?? process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_TRIP_PASS_PRICE_ID;
if (!key || !priceId) throw new Error("Protected Stripe test-mode configuration is incomplete.");

const stripe = new Stripe(key);
const ordering: string[] = ["provider_lookup_started"];
const price = await providerCall(() => stripe.prices.retrieve(priceId));
ordering.push("provider_lookup_completed");
if (price.livemode) {
  throw new Error("Stripe live mode is forbidden in the protected release-candidate lane.");
}
if (!price.active) throw new Error("The protected Stripe test Price must be active.");

const providerChecks = await runStripeTestModeChecks({
  appOrigin: required("PROVIDER_RC_APP_ORIGIN"),
  checkedOutCommitSha,
  price,
  runScope: `${required("GITHUB_RUN_ID")}:${required("GITHUB_RUN_ATTEMPT")}`,
  stripe,
});

ordering.push("application_started");
assertProviderBeforeApplication(ordering);
await runContractTests();

console.log(
  JSON.stringify({
    checkedOutCommitSha,
    lane: "stripe",
    priceActive: true,
    providerChecks,
    providerMode: "test",
    semanticOrdering: "provider_lookup_completed_before_application_started",
  }),
);

async function runStripeTestModeChecks(input: {
  appOrigin: string;
  checkedOutCommitSha: string;
  price: Stripe.Price;
  runScope: string;
  stripe: Stripe;
}) {
  const checkoutIdempotencyKey = `provider_rc_checkout:${input.checkedOutCommitSha}:${input.runScope}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
  const checkoutParams = {
    mode: "payment",
    line_items: [{ price: input.price.id, quantity: 1 }],
    expires_at: expiresAt,
    success_url: `${input.appOrigin}/settings?trip_pass_checkout=return`,
    cancel_url: `${input.appOrigin}/settings?trip_pass_checkout=cancelled`,
    metadata: { releaseCandidateSha: input.checkedOutCommitSha },
  } satisfies Stripe.Checkout.SessionCreateParams;

  const checkout = await providerCall(() =>
    input.stripe.checkout.sessions.create(checkoutParams, {
      idempotencyKey: checkoutIdempotencyKey,
    }),
  );
  const retry = await providerCall(() =>
    input.stripe.checkout.sessions.create(checkoutParams, {
      idempotencyKey: checkoutIdempotencyKey,
    }),
  );
  if (checkout.id !== retry.id || checkout.livemode || checkout.expires_at !== expiresAt) {
    throw new Error("Stripe test Checkout idempotency or expiry evidence did not match.");
  }
  const retrievedCheckout = await providerCall(() =>
    input.stripe.checkout.sessions.retrieve(checkout.id),
  );
  if (retrievedCheckout.status !== "open") {
    throw new Error("Stripe test Checkout did not remain open before explicit expiry.");
  }
  const expiredCheckout = await providerCall(() =>
    input.stripe.checkout.sessions.expire(checkout.id),
  );
  if (expiredCheckout.status !== "expired") {
    throw new Error("Stripe test Checkout explicit expiry was not authoritative.");
  }

  const amount = input.price.unit_amount;
  const currency = input.price.currency;
  if (!amount || amount < 2)
    throw new Error("Stripe test Price amount must allow partial refunds.");
  const paidIntent = await providerCall(() =>
    input.stripe.paymentIntents.create(
      {
        amount,
        automatic_payment_methods: { allow_redirects: "never", enabled: true },
        confirm: true,
        currency,
        metadata: { releaseCandidateSha: input.checkedOutCommitSha },
        payment_method: "pm_card_visa",
      },
      { idempotencyKey: `provider_rc_payment:${input.checkedOutCommitSha}:${input.runScope}` },
    ),
  );
  if (paidIntent.livemode || paidIntent.status !== "succeeded") {
    throw new Error("Stripe test card payment did not succeed in test mode.");
  }
  const firstRefundAmount = Math.floor(amount / 2);
  await providerCall(() =>
    input.stripe.refunds.create(
      { amount: firstRefundAmount, payment_intent: paidIntent.id },
      {
        idempotencyKey: `provider_rc_refund_partial:${input.checkedOutCommitSha}:${input.runScope}`,
      },
    ),
  );
  await providerCall(() =>
    input.stripe.refunds.create(
      { amount: amount - firstRefundAmount, payment_intent: paidIntent.id },
      {
        idempotencyKey: `provider_rc_refund_remainder:${input.checkedOutCommitSha}:${input.runScope}`,
      },
    ),
  );
  const refundedIntent = await providerCall(() =>
    input.stripe.paymentIntents.retrieve(paidIntent.id, { expand: ["latest_charge"] }),
  );
  const refundedCharge =
    typeof refundedIntent.latest_charge === "string" ? null : refundedIntent.latest_charge;
  if (!refundedCharge || refundedCharge.amount_refunded !== amount || !refundedCharge.refunded) {
    throw new Error("Stripe cumulative test refunds did not reach the full paid amount.");
  }

  const disputedIntent = await providerCall(() =>
    input.stripe.paymentIntents.create(
      {
        amount,
        automatic_payment_methods: { allow_redirects: "never", enabled: true },
        confirm: true,
        currency,
        expand: ["latest_charge"],
        metadata: { releaseCandidateSha: input.checkedOutCommitSha },
        payment_method: "pm_card_createDispute",
      },
      { idempotencyKey: `provider_rc_dispute:${input.checkedOutCommitSha}:${input.runScope}` },
    ),
  );
  const disputedCharge =
    typeof disputedIntent.latest_charge === "string" ? null : disputedIntent.latest_charge;
  if (
    disputedIntent.livemode ||
    disputedIntent.status !== "succeeded" ||
    !disputedCharge?.disputed
  ) {
    throw new Error("Stripe test dispute payment did not succeed in test mode.");
  }

  return {
    cardPayment: "test_mode_succeeded",
    checkout: "created_retrieved_expired",
    cumulativeRefund: "full_amount_confirmed",
    dispute: "test_mode_created",
    idempotentRetry: "same_checkout_session",
  } as const;
}

async function runContractTests() {
  const process = Bun.spawn(
    [
      "bun",
      "test",
      "src/server/trip-pass/commerce.test.ts",
      "src/server/trip-pass/webhook-application.test.ts",
      "src/server/trip-pass/payment-lifecycle.test.ts",
      "src/server/trip-pass/reconciliation.test.ts",
      "src/server/trip-pass/paid-after-closure-refund.test.ts",
      "src/server/trip-pass/usage.test.ts",
      "src/server/qa/provider-release-candidate.test.ts",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await process.exited) !== 0) {
    throw new Error("Stripe release-candidate contract tests failed.");
  }
}

async function providerCall<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch {
    throw new Error("A redacted Stripe test-mode provider operation failed.");
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the protected Stripe lane.`);
  return value;
}

async function readHeadSha() {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error("Unable to resolve the checked-out commit.");
  return stdout.trim();
}
