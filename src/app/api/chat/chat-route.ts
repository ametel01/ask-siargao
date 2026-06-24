import { z } from "zod";

import {
  type AskSiargaoChatMessage,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(12),
});

export type ChatRouteDependencies = {
  generateAskSiargaoChatResponse: typeof generateAskSiargaoChatResponse;
};

const defaultDependencies: ChatRouteDependencies = {
  generateAskSiargaoChatResponse,
};

export async function chatResponse(
  request: Request,
  dependencies: ChatRouteDependencies = defaultDependencies,
  headers?: HeadersInit,
) {
  let body: unknown;
  try {
    body = await request.json();
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

  try {
    const result = await dependencies.generateAskSiargaoChatResponse({
      messages: parsed.data.messages satisfies AskSiargaoChatMessage[],
    });

    return Response.json(result, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat response failed.";
    const missingConfiguration = message.includes("OPENAI_API_KEY");

    return Response.json(
      {
        error: missingConfiguration ? "chat_not_configured" : "chat_generation_failed",
        message: missingConfiguration
          ? "OpenAI is not configured for chat responses."
          : "Ask Siargao could not generate a response right now.",
      },
      { status: missingConfiguration ? 503 : 502, headers },
    );
  }
}
