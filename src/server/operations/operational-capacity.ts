import { providerRequestTimeoutMs } from "@/server/providers/provider-abort";

export const operationalCronInternalDeadlineMs = 55_000;
export const operationalWorkerMinimumStartBudgetMs = 46_000;
export const operationalWorkerLeaseSeconds = 300;
export const riskReconciliationBatchSize = 50;
export const riskReconciliationRequiredIntervalMs = 5 * 60_000;
export const riskReconciliationCronAlignmentBudgetMs = 60_000;
export const riskReconciliationApplicationBudgetMs = 15_000;
export const operationalWorkerProviderCompletionBudgetMs =
  operationalWorkerMinimumStartBudgetMs - riskReconciliationApplicationBudgetMs;
export const riskReconciliationEligibilityMs =
  riskReconciliationRequiredIntervalMs -
  riskReconciliationCronAlignmentBudgetMs -
  providerRequestTimeoutMs -
  riskReconciliationApplicationBudgetMs;

// Keep the admitted risk population within one every-minute worker batch.
export const riskReconciliationOrderCapacity = riskReconciliationBatchSize;
