import { z } from "zod";

import {
  type AskSiargaoChatMessage,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
import {
  type OpenMeteoForecastLocation,
  siargaoForecastLocations,
} from "@/server/providers/open-meteo";
import {
  getLatestSiargaoWeatherSnapshot,
  type WeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

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
  getLatestSiargaoWeatherSnapshot?: typeof getLatestSiargaoWeatherSnapshot;
};

const defaultDependencies: Required<ChatRouteDependencies> = {
  generateAskSiargaoChatResponse,
  getLatestSiargaoWeatherSnapshot,
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
    const weatherContext = await getWeatherContext(parsed.data.messages, dependencies);
    const result = await dependencies.generateAskSiargaoChatResponse({
      messages: parsed.data.messages satisfies AskSiargaoChatMessage[],
      ...(weatherContext ? { weatherContext } : {}),
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

async function getWeatherContext(
  messages: readonly AskSiargaoChatMessage[],
  dependencies: ChatRouteDependencies,
): Promise<WeatherSnapshot | undefined> {
  if (!isWeatherQuestion(messages)) {
    return undefined;
  }

  try {
    const getSnapshot =
      dependencies.getLatestSiargaoWeatherSnapshot ??
      defaultDependencies.getLatestSiargaoWeatherSnapshot;
    const location = detectWeatherLocation(messages);
    return await (location ? getSnapshot({ location }) : getSnapshot());
  } catch {
    return undefined;
  }
}

function detectWeatherLocation(
  messages: readonly AskSiargaoChatMessage[],
): OpenMeteoForecastLocation | undefined {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const content = latestUserMessage?.content ?? "";

  if (/\bdel\s+carmen\b/i.test(content)) {
    return siargaoForecastLocations.delCarmen;
  }

  return undefined;
}

function isWeatherQuestion(messages: readonly AskSiargaoChatMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");

  return latestUserMessage
    ? /\b(weather|forecast|rain|raining|showers?|wind|windy|storm|cloudy|sunny|humidity|temperature|temp|tide|waves?|surf|sea conditions?)\b/i.test(
        latestUserMessage.content,
      )
    : false;
}
