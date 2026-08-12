import { z } from "zod";

import type { AgentProgressUpdate } from "@/server/chat/agent-runtime";
import {
  createDefaultDurableTravelAnswerDependencies,
  type DurableTravelAnswerInput,
  type DurableTravelAnswerOptions,
  type DurableTravelAnswerOutcome,
  answerTravelQuestion as defaultAnswerTravelQuestion,
  type TravelAnswerLatencyMetrics,
} from "@/server/chat/durable-travel-answer";
import type { TripContextClientContextInput } from "@/server/chat/trip-context";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";
import { trackServerEvent } from "@/server/observability/events";

const chatRequestSchema = z.strictObject({
  threadId: z.string().min(1).max(128).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(12),
  clientContext: z
    .object({
      geolocation: z
        .strictObject({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracyMeters: z.number().min(0).optional(),
          capturedAt: z.iso.datetime(),
          consentScope: z.enum(["single_request", "trip_session"]),
        })
        .optional(),
      tripContext: z.unknown().optional(),
    })
    .optional(),
});

export type ChatRouteDependencies = {
  answerTravelQuestion: (
    input: DurableTravelAnswerInput,
    options?: DurableTravelAnswerOptions,
  ) => Promise<DurableTravelAnswerOutcome>;
};

const maxChatRequestBodyBytes = 32_768;

export function createDefaultChatRouteDependencies(
  options: { deferPersistence?: (task: () => Promise<void>) => void } = {},
): ChatRouteDependencies {
  const durableTravelAnswerDependencies = {
    ...createDefaultDurableTravelAnswerDependencies(),
    ...options,
  };
  return {
    answerTravelQuestion: (input, answerOptions) =>
      defaultAnswerTravelQuestion(input, durableTravelAnswerDependencies, answerOptions),
  };
}

export async function chatResponse(
  request: Request,
  dependencies: ChatRouteDependencies = createDefaultChatRouteDependencies(),
  headers?: HeadersInit,
) {
  const startedAt = Date.now();
  const rawBody = await readChatRequestBodyText(request);
  if (rawBody.status === "too_large") {
    return Response.json(
      {
        error: "request_too_large",
        message: `Request body must be ${maxChatRequestBodyBytes} bytes or smaller.`,
      },
      { status: 413, headers },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.text);
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400, headers },
    );
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_chat_request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400, headers },
    );
  }

  const input = {
    body: rawBody.text,
    request,
    messages: parsed.data.messages satisfies AskSiargaoChatMessage[],
    ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
    ...(parsed.data.clientContext
      ? {
          clientContext: parsed.data.clientContext as TripContextClientContextInput,
        }
      : {}),
  };
  const { answerTravelQuestion } = dependencies;

  if (request.headers.get("accept")?.includes("application/x-ndjson")) {
    return createStreamingChatResponse({
      execute: (onProgress, onHeadersReady) =>
        answerTravelQuestion(input, {
          headers,
          onHeadersReady,
          onProgress,
          startedAt,
        }),
      startedAt,
    });
  }

  const answer = await answerTravelQuestion(input, {
    headers,
    startedAt,
  });
  const response = responseFromTravelAnswer(answer);
  recordChatLatency(answer, startedAt, Date.now() - startedAt, false);
  return response;
}

async function createStreamingChatResponse({
  execute,
  startedAt,
}: {
  execute: (
    onProgress: (update: AgentProgressUpdate) => Promise<void>,
    onHeadersReady: (headers: Headers) => void,
  ) => Promise<DurableTravelAnswerOutcome>;
  startedAt: number;
}) {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const writeEvent = (event: Record<string, unknown>) =>
    writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
  let firstByteMs = 0;
  let resolveHeaders: (headers: Headers) => void = () => {};
  let rejectHeaders: (error: unknown) => void = () => {};
  const headersReady = new Promise<Headers>((resolve, reject) => {
    resolveHeaders = resolve;
    rejectHeaders = reject;
  });

  void (async () => {
    try {
      void writeEvent({
        type: "progress",
        stage: "accepted",
        message: "Starting your Ask Siargao answer.",
      }).catch(() => undefined);
      firstByteMs = Date.now() - startedAt;
      const answerPromise = execute(
        (update) => writeEvent({ type: "progress", ...update }).catch(() => undefined),
        resolveHeaders,
      );
      void answerPromise.then(
        (answer) => resolveHeaders(answer.headers),
        (error) => rejectHeaders(error),
      );
      const answer = await answerPromise;
      await writeEvent({ type: "result", status: answer.status, body: answer.body });
      recordChatLatency(answer, startedAt, firstByteMs, true);
    } catch (error) {
      rejectHeaders(error);
      await writeEvent({
        type: "result",
        status: 502,
        body: {
          error: "chat_stream_failed",
          message: "Ask Siargao could not finish the streamed response.",
        },
      }).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  const responseHeaders = new Headers(await headersReady);
  responseHeaders.set("cache-control", "no-cache, no-store");
  responseHeaders.set("content-type", "application/x-ndjson; charset=utf-8");
  responseHeaders.set("x-accel-buffering", "no");
  return new Response(readable, { headers: responseHeaders });
}

function responseFromTravelAnswer(answer: DurableTravelAnswerOutcome) {
  return Response.json(answer.body, {
    status: answer.status,
    headers: answer.headers,
  });
}

function recordChatLatency(
  answer: Pick<DurableTravelAnswerOutcome, "latency" | "status">,
  startedAt: number,
  firstByteMs: number,
  streamed: boolean,
) {
  const latency: TravelAnswerLatencyMetrics = answer.latency;
  trackServerEvent({
    name: "chat_latency_recorded",
    payload: {
      status: answer.status >= 200 && answer.status < 300 ? "success" : "error",
      streamed,
      totalMs: Date.now() - startedAt,
      firstByteMs,
      preflightMs: latency.preflightMs,
      agentMs: latency.agentMs ?? 0,
      modelMs: latency.modelMs ?? 0,
      settlementMs: latency.settlementMs ?? 0,
      persistenceMs: latency.persistenceMs ?? 0,
      modelCallCount: latency.modelCallCount ?? 0,
      toolCallCount: latency.toolCallCount ?? 0,
      repairCount: latency.repairCount ?? 0,
      modelCalls: latency.modelCalls ?? [],
      tools: latency.tools ?? [],
    },
  });
}

async function readChatRequestBodyText(request: Request) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxChatRequestBodyBytes) {
    return { status: "too_large" as const };
  }

  if (!request.body) {
    return { status: "ok" as const, text: "" };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const value of request.body) {
    totalBytes += value.byteLength;
    if (totalBytes > maxChatRequestBodyBytes) {
      return { status: "too_large" as const };
    }
    chunks.push(value);
  }

  return {
    status: "ok" as const,
    text: new TextDecoder().decode(concatChunks(chunks, totalBytes)),
  };
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number) {
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}
