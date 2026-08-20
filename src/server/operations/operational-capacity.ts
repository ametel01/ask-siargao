export const operationalCronInternalDeadlineMs = 55_000;
export const operationalWorkerMinimumStartBudgetMs = 46_000;
export const riskReconciliationBatchSize = 50;

// Four full every-minute batches leave one cadence minute for scheduler jitter and alert work.
export const riskReconciliationOrderCapacity = riskReconciliationBatchSize * 4;
