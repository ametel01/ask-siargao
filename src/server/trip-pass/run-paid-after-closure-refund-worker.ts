import { runPaidAfterClosureRefundBatch } from "@/server/trip-pass/paid-after-closure-refund";

const result = await runPaidAfterClosureRefundBatch({
  limit: readPositiveInteger(process.env.PAID_AFTER_CLOSURE_REFUND_BATCH_SIZE, 100),
  alertAfterAttempts: readPositiveInteger(
    process.env.PAID_AFTER_CLOSURE_REFUND_ALERT_AFTER_ATTEMPTS,
    3,
  ),
});

console.info(JSON.stringify({ ...result, checked: "paid-after-closure-refund-worker" }));

function readPositiveInteger(raw: string | undefined, fallback: number) {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Paid After Closure refund worker settings must be positive integers.");
  }
  return value;
}
