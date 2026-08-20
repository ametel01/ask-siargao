export type OperationTraceEvent = {
  index: number;
  operation: string;
  result: "started" | "succeeded" | "failed" | "skipped";
};

export type OperationEventRecorder = (event: OperationTraceEvent) => void | Promise<void>;

export type OperationTrace = {
  events: OperationTraceEvent[];
  record: OperationEventRecorder;
};

export function createOperationTrace(recorder?: OperationEventRecorder): OperationTrace {
  const events: OperationTraceEvent[] = [];
  return {
    events,
    async record(event) {
      const safeEvent = { ...event, index: events.length };
      events.push(safeEvent);
      await recorder?.(safeEvent);
    },
  };
}

export const operationalTaskTypes = [
  "account_closure",
  "checkout_return_lookup",
  "pending_payment_event",
  "pending_stripe_event",
  "paid_after_closure_refund",
  "lemon_squeezy_refund",
  "retention_purge",
  "commerce_reconciliation",
] as const;

export type OperationalTaskType = (typeof operationalTaskTypes)[number];

export type OperationalTaskHandler = (input: {
  deadlineAt?: number;
  resourceRef: string;
  signal?: AbortSignal;
  trace: OperationTrace;
}) => Promise<void>;

export type OperationalTaskHandlers = Partial<Record<OperationalTaskType, OperationalTaskHandler>>;
