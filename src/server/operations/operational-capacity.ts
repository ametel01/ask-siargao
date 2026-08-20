export const operationalCronInternalDeadlineMs = 55_000;
export const operationalWorkerMinimumStartBudgetMs = 46_000;
export const operationalWorkerLeaseSeconds = 300;
export const riskReconciliationBatchSize = 50;

// Keep the admitted risk population within one every-minute worker batch.
export const riskReconciliationOrderCapacity = riskReconciliationBatchSize;
