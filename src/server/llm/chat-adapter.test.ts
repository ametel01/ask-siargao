import { describe, expect, test } from "bun:test";

import {
  type ChatResponsesClient,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

describe("Ask Siargao chat adapter", () => {
  test("includes weather context in the OpenAI request when provided", async () => {
    const requests: Record<string, unknown>[] = [];
    const client: ChatResponsesClient = {
      responses: {
        create: async (params) => {
          requests.push(params);
          return {
            output_text: "Today looks variable, so plan around rain and wind windows.",
            _request_id: "req_weather_context",
          };
        },
      },
    };

    const response = await generateAskSiargaoChatResponse({
      client,
      messages: [{ role: "user", content: "What's the weather today in Siargao?" }],
      weatherContext: fallbackWeatherSnapshot,
    });

    const request = requests[0];
    const input = parseOpenAIInput(request?.input);

    expect(response.requestId).toBe("req_weather_context");
    expect(String(request?.instructions)).toContain("When weatherContext is present");
    expect(input.weatherContext?.status).toBe("fallback");
    expect(input.weatherContext?.sourceProfileId).toBe("source_open_meteo");
    expect(input.weatherContext?.summary).toContain("Open-Meteo");
  });
});

function parseOpenAIInput(input: unknown): {
  weatherContext?: {
    status?: string;
    sourceProfileId?: string;
    summary?: string;
  };
} {
  return typeof input === "string" ? JSON.parse(input) : {};
}
