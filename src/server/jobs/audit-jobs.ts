import { randomUUID } from "node:crypto";

export type AuditJobKind = "generate_audit" | "review_audit" | "publish_report";
export type AuditJobRunState = "queued" | "running" | "succeeded" | "failed";

export type QueuedAuditJob = {
  id: string;
  auditRequestId: string;
  kind: AuditJobKind;
  state: AuditJobRunState;
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  lastError?: string;
  diagnostics: Array<{
    at: string;
    phase: AuditJobKind;
    message: string;
    context?: Record<string, unknown>;
  }>;
};

export type AuditJobHandlers = {
  generateAudit: (job: QueuedAuditJob) => Promise<void>;
  reviewAudit: (job: QueuedAuditJob) => Promise<void>;
  publishReport: (job: QueuedAuditJob) => Promise<void>;
};

export function enqueueAuditGenerationJob(auditRequestId: string, now = new Date()) {
  return createAuditJob("generate_audit", auditRequestId, now);
}

function createAuditJob(kind: AuditJobKind, auditRequestId: string, now = new Date()) {
  return {
    id: `job_${randomUUID()}`,
    auditRequestId,
    kind,
    state: "queued",
    attempts: 0,
    maxAttempts: 3,
    queuedAt: now.toISOString(),
    diagnostics: [],
  } satisfies QueuedAuditJob;
}

export async function runAuditJob(
  job: QueuedAuditJob,
  handlers: AuditJobHandlers,
  now = new Date(),
) {
  const running = startAuditJob(job, now);

  try {
    await handlerFor(running.kind, handlers)(running);
    const completed = completeAuditJob(running, now);
    return {
      job: completed,
      nextJob: nextAuditJobAfterSuccess(completed, now),
    };
  } catch (error) {
    return {
      job: recordAuditJobFailure(running, error, now),
      nextJob: undefined,
    };
  }
}

function startAuditJob(job: QueuedAuditJob, now = new Date()) {
  return {
    ...job,
    state: "running" as const,
    attempts: job.attempts + 1,
    startedAt: now.toISOString(),
  };
}

function completeAuditJob(job: QueuedAuditJob, now = new Date()) {
  return {
    ...job,
    state: "succeeded" as const,
    completedAt: now.toISOString(),
  };
}

export function recordAuditJobFailure(
  job: QueuedAuditJob,
  error: unknown,
  now = new Date(),
): QueuedAuditJob {
  const message = error instanceof Error ? error.message : String(error);

  return {
    ...job,
    state: "failed",
    failedAt: now.toISOString(),
    lastError: message,
    diagnostics: [
      ...job.diagnostics,
      {
        at: now.toISOString(),
        phase: job.kind,
        message,
        context: {
          attempts: job.attempts,
          retryable: job.attempts < job.maxAttempts,
        },
      },
    ],
  };
}

function nextAuditJobAfterSuccess(job: QueuedAuditJob, now = new Date()) {
  if (job.kind === "generate_audit") {
    return createAuditJob("review_audit", job.auditRequestId, now);
  }
  if (job.kind === "review_audit") {
    return createAuditJob("publish_report", job.auditRequestId, now);
  }

  return undefined;
}

function handlerFor(kind: AuditJobKind, handlers: AuditJobHandlers) {
  if (kind === "generate_audit") {
    return handlers.generateAudit;
  }
  if (kind === "review_audit") {
    return handlers.reviewAudit;
  }

  return handlers.publishReport;
}
