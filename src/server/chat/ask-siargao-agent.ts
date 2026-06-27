import OpenAI from "openai";

import { type AgentMemorySnapshot, loadAgentMemorySnapshot } from "@/server/chat/agent-memory";
import {
  type AgentMemoryMetadata,
  type AgentResponsesClient,
  type AgentRuntimeDependencies,
  type AgentRuntimeRequest,
  type AgentToolCallAudit,
  type AgentToolExecutionRequest,
  type AgentToolResult,
  type AgentTurnResult,
  createAgentToolCallAudit,
  createAgentTurnResult,
  resolveAgentRuntimeRequest,
} from "@/server/chat/agent-runtime";
import {
  type AgentToolDependencies,
  buildAgentResponseTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";
import type {
  ItineraryRequiredToolChecks,
  LocalItineraryRequest,
} from "@/server/chat/itinerary-tools";
import { createComponentLogger } from "@/server/observability/logger";

export type AskSiargaoAgentDependencies = AgentRuntimeDependencies &
  AgentToolDependencies & {
    agentMemoryVectorStoreId?: string;
    forceAgentMemorySearchFallback?: boolean;
    includeAgentMemoryFallbackWithFileSearch?: boolean;
    loadMemorySnapshot?: () => AgentMemorySnapshot;
    now?: () => Date;
  };

type ParsedFunctionCall = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ModelFacingAgentMemoryMetadata = {
  versionId: string;
  files: Array<{
    id: string;
    role: AgentMemoryMetadata["files"][number]["role"];
  }>;
};

const defaultMaxToolCalls = 8;
const defaultMaxTurns = 6;
const maxConversationMessages = 10;
const agentLogger = createComponentLogger("chat_agent");

function createOpenAIAgentClient(apiKey = process.env.OPENAI_API_KEY): AgentResponsesClient {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Ask Siargao agent chat.");
  }

  return new OpenAI({ apiKey, timeout: 30_000 }) as AgentResponsesClient;
}

export async function runAskSiargaoAgentTurn(
  request: AgentRuntimeRequest,
  dependencies: AskSiargaoAgentDependencies = {},
): Promise<AgentTurnResult> {
  const resolved = resolveAgentRuntimeRequest(request, dependencies);
  const client = dependencies.client ?? createOpenAIAgentClient();
  const memorySnapshot =
    dependencies.memorySnapshot ?? dependencies.loadMemorySnapshot?.() ?? loadAgentMemorySnapshot();
  const toolDependencies: AgentToolDependencies = { ...dependencies, memorySnapshot };
  const executeTool =
    dependencies.executeTool ??
    ((toolRequest: AgentToolExecutionRequest) => executeAgentTool(toolRequest, toolDependencies));
  const logger = (dependencies.logger ?? agentLogger).child({ requestId: resolved.requestId });
  const upstreamRequestIds: string[] = [];
  const toolCalls: AgentToolCallAudit[] = [];
  const toolResults: AgentToolResult[] = [];
  const maxToolCalls = dependencies.maxToolCalls ?? defaultMaxToolCalls;
  const maxTurns = dependencies.maxTurns ?? defaultMaxTurns;
  const agentMemoryVectorStoreId =
    dependencies.agentMemoryVectorStoreId ?? process.env.OPENAI_AGENT_MEMORY_VECTOR_STORE_ID;
  const memory = createAgentMemoryMetadata(memorySnapshot, agentMemoryVectorStoreId);
  const instructions = buildAskSiargaoAgentInstructions(memorySnapshot);
  const tools = buildAgentResponseTools(memorySnapshot, {
    vectorStoreId: agentMemoryVectorStoreId,
    forceMemoryFallback: dependencies.forceAgentMemorySearchFallback,
    includeMemoryFallbackWithFileSearch: dependencies.includeAgentMemoryFallbackWithFileSearch,
  });

  logger.info(
    {
      model: resolved.model,
      messageCount: resolved.messages.length,
      maxToolCalls,
      maxTurns,
      agentMemory: summarizeMemoryForLogs(memory),
    },
    "Ask Siargao agent turn started.",
  );

  let response = await client.responses.create({
    model: resolved.model,
    store: false,
    max_output_tokens: 1_000,
    instructions,
    tools,
    input: JSON.stringify({
      product: "Ask Siargao",
      conversation: resolved.messages.slice(-maxConversationMessages),
      requestMetadata: resolved.metadata,
      deterministicSignals: resolved.deterministicSignals,
      agentMemory: summarizeMemoryForModel(memory),
      responseContract: responseContract,
    }),
  });
  collectUpstreamRequestId(response._request_id, upstreamRequestIds);

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const finalText = response.output_text?.trim();
    if (finalText) {
      const itineraryPlanRepairCall = missingInitialItineraryPlanRepairCall(
        resolved,
        toolCalls,
        toolResults,
      );
      if (itineraryPlanRepairCall) {
        if (toolCalls.length + 1 > maxToolCalls) {
          throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
        }

        // Validation repair only: the model should choose plan_local_itinerary first. If it
        // tries final itinerary prose anyway, the runtime repairs the missing contract evidence.
        const automaticPlanOutput = await executeAndAuditTool({
          executeTool,
          functionCall: itineraryPlanRepairCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          requestId: resolved.requestId,
        });
        toolCalls.push(automaticPlanOutput.audit);
        toolResults.push(automaticPlanOutput.result);

        response = await client.responses.create({
          model: resolved.model,
          store: false,
          max_output_tokens: 1_000,
          instructions,
          tools,
          ...(response.id ? { previous_response_id: response.id } : {}),
          input: JSON.stringify({
            product: "Ask Siargao",
            instruction:
              "Validation repair: you attempted a final itinerary answer before choosing plan_local_itinerary as required. Use this runtime-repaired itinerary artifact as planning evidence, preserve its caveats, and continue with any required follow-up checks before the final traveler-facing answer.",
            validationRepairItineraryPlan: {
              toolCallId: automaticPlanOutput.functionCall.callId,
              name: automaticPlanOutput.functionCall.name,
              arguments: automaticPlanOutput.functionCall.arguments,
              result: JSON.parse(serializeToolOutput(automaticPlanOutput.result)),
            },
            responseContract,
          }),
        });
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        continue;
      }

      const missingRequiredChecks = missingRequiredItineraryChecks(toolResults, toolCalls);
      if (missingRequiredChecks.length > 0) {
        if (toolCalls.length + missingRequiredChecks.length > maxToolCalls) {
          throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
        }

        const automaticToolOutputs = await Promise.all(
          missingRequiredChecks.map((functionCall) =>
            executeAndAuditTool({
              executeTool,
              functionCall,
              logger,
              now: dependencies.now ?? (() => new Date()),
              requestId: resolved.requestId,
            }),
          ),
        );
        toolCalls.push(...automaticToolOutputs.map((output) => output.audit));
        toolResults.push(...automaticToolOutputs.map((output) => output.result));

        response = await client.responses.create({
          model: resolved.model,
          store: false,
          max_output_tokens: 1_000,
          instructions,
          tools,
          ...(response.id ? { previous_response_id: response.id } : {}),
          input: JSON.stringify({
            product: "Ask Siargao",
            instruction:
              "You attempted a final itinerary answer before required follow-up checks completed. Use these automatically executed safe tool outputs, preserve provider failures as caveats, and write the final traveler-facing answer now.",
            automaticRequiredToolChecks: automaticToolOutputs.map((output) => ({
              toolCallId: output.functionCall.callId,
              name: output.functionCall.name,
              arguments: output.functionCall.arguments,
              result: JSON.parse(serializeToolOutput(output.result)),
            })),
            responseContract,
          }),
        });
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        continue;
      }

      logger.info(
        {
          durationMs: sumDurations(toolCalls),
          model: resolved.model,
          toolCallCount: toolCalls.length,
          upstreamRequestCount: upstreamRequestIds.length,
          agentMemoryVersionId: memory.versionId,
        },
        "Ask Siargao agent turn completed.",
      );
      return createAgentTurnResult({
        message: finalText,
        requestId: resolved.requestId,
        model: resolved.model,
        memory,
        upstreamRequestIds,
        toolCalls,
        toolResults,
      });
    }

    const functionCalls = extractFunctionCalls(response.output);
    if (functionCalls.length === 0) {
      throw new Error("OpenAI response did not include output_text.");
    }

    if (toolCalls.length + functionCalls.length > maxToolCalls) {
      throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
    }

    const toolOutputs = await Promise.all(
      functionCalls.map((functionCall) =>
        executeAndAuditTool({
          executeTool,
          functionCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          requestId: resolved.requestId,
        }),
      ),
    );
    toolCalls.push(...toolOutputs.map((output) => output.audit));
    toolResults.push(...toolOutputs.map((output) => output.result));

    response = await client.responses.create({
      model: resolved.model,
      store: false,
      max_output_tokens: 1_000,
      instructions,
      tools,
      previous_response_id: response.id,
      input: toolOutputs.map((output) => ({
        type: "function_call_output",
        call_id: output.functionCall.callId,
        output: serializeToolOutput(output.result),
      })),
    });
    collectUpstreamRequestId(response._request_id, upstreamRequestIds);
  }

  throw new Error("Ask Siargao agent exceeded the maximum turn count.");
}

function missingInitialItineraryPlanRepairCall(
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
): ParsedFunctionCall | undefined {
  if (hasSuccessfulItineraryPlanArtifact(toolCalls, toolResults)) {
    return undefined;
  }

  const argumentsForPlan = inferRequiredInitialItineraryPlanArguments(request);
  if (!argumentsForPlan) {
    return undefined;
  }

  return {
    callId: "auto_required_itinerary_plan_1",
    name: "plan_local_itinerary",
    arguments: argumentsForPlan,
  };
}

function inferRequiredInitialItineraryPlanArguments(
  request: AgentRuntimeRequest,
): Record<string, unknown> | undefined {
  const latestUserTurn = latestUserContent(request.messages);
  const userContext = request.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ");
  if (!isItineraryPlanningRequest(latestUserTurn, request.deterministicSignals)) {
    return undefined;
  }

  const theme = inferLocalItineraryTheme(userContext);
  const constraints = inferItineraryConstraints(userContext, request.deterministicSignals);
  const transportMode = inferItineraryTransportMode(userContext, request.deterministicSignals);
  const durationHours = inferItineraryDurationHours(userContext);
  const maxRideMinutes = inferMaxRideMinutes(userContext, request.deterministicSignals);
  const origin = inferItineraryOrigin(userContext, request.deterministicSignals);
  const mealPreference = inferMealPreference(userContext, constraints);

  return {
    theme,
    ...(origin ? { origin } : {}),
    ...(durationHours ? { duration_hours: durationHours } : {}),
    ...(transportMode ? { transport_mode: transportMode } : {}),
    ...(maxRideMinutes ? { max_ride_minutes: maxRideMinutes } : {}),
    ...(needsWeatherCheck(userContext, request.deterministicSignals)
      ? { needs_weather_check: true }
      : {}),
    ...(needsOpenNowCheck(theme, userContext) ? { needs_open_now: true } : {}),
    ...(mealPreference ? { meal_preference: mealPreference } : {}),
    ...(constraints.length ? { constraints } : {}),
  } satisfies Partial<LocalItineraryRequest>;
}

function isItineraryPlanningRequest(
  latestUserTurn: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  if (latestUserTurn.trim().length === 0) {
    return false;
  }
  if (isExcludedItineraryRepairRequest(latestUserTurn)) {
    return false;
  }
  const hasActivityPlanSignal =
    readBooleanPath(deterministicSignals, ["intent", "activityPlan"]) === true;
  const hasInitialThemeLanguage =
    /\b(rainy\s+cloud\s*9|sunset\s+(?:plus|and)\s+dinner|dinner\s+(?:after|plus|and)\s+sunset|food\s+crawl|(?:non[-\s]?surfer|not\s+surfing|sandy\s+beach|beach)\s+half[-\s]?day|half[-\s]?day\s+(?:non[-\s]?surfer|not\s+surfing|sandy\s+)?beach)\b/i.test(
      latestUserTurn,
    );
  const hasScopedDuration =
    /\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(latestUserTurn) ||
    /\bhalf[-\s]?day\b/i.test(latestUserTurn);
  const hasRouteWithStops =
    /\b(?:route|sequence)\b/i.test(latestUserTurn) && /\bstops?\b/i.test(latestUserTurn);
  const hasScopedItineraryLanguage =
    hasInitialThemeLanguage ||
    (hasScopedDuration &&
      /\b(itinerary|plan|route|sequence|stops?|things?\s+to\s+do|activities?)\b/i.test(
        latestUserTurn,
      )) ||
    hasRouteWithStops;

  return hasInitialThemeLanguage || (hasActivityPlanSignal && hasScopedItineraryLanguage);
}

function isExcludedItineraryRepairRequest(content: string) {
  if (
    /\b(critique|review|audit|improve\s+my\s+itinerary|plan\s+my\s+(?:trip|vacation|holiday))\b/i.test(
      content,
    )
  ) {
    return true;
  }
  return (
    /\b(airport|flight|ferry|pier|port|transfer|pickup|pick\s+up|drop[-\s]?off|taxi|shuttle|transport|transportation|logistics?)\b/i.test(
      content,
    ) && !hasScopedLocalItineraryContent(content)
  );
}

function hasScopedLocalItineraryContent(content: string) {
  return (
    /\b(rainy\s+cloud\s*9|sunset\s+(?:plus|and)\s+dinner|dinner\s+(?:after|plus|and)\s+sunset|food\s+crawl|(?:non[-\s]?surfer|not\s+surfing|sandy\s+beach|beach)\s+half[-\s]?day|half[-\s]?day\s+(?:non[-\s]?surfer|not\s+surfing|sandy\s+)?beach)\b/i.test(
      content,
    ) ||
    (/\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(content) &&
      /\b(food\s+crawl|crawl|things?\s+to\s+do|activities?|stops?|beaches?|sunset|dinner|lunch|breakfast|brunch|caf[eé]s?|restaurants?|eat)\b/i.test(
        content,
      )) ||
    (/\b(?:route|sequence)\b/i.test(content) && /\bstops?\b/i.test(content))
  );
}

function inferLocalItineraryTheme(content: string): LocalItineraryRequest["theme"] {
  if (/\bfood\s+crawl|crawl\b/i.test(content)) {
    return "food_crawl";
  }
  if (/\brainy|rain(?:ing)?|showers?|storm|covered|indoors?|inside\b/i.test(content)) {
    return "rainy_cloud_9_afternoon";
  }
  if (/\bsunset\b/i.test(content) || /\bdinner\b/i.test(content)) {
    return "sunset_plus_dinner";
  }
  if (/\b(non[-\s]?surfer|not\s+surfing|avoid\s+surf|no\s+surf(?:ing)?)\b/i.test(content)) {
    return "non_surfer_half_day";
  }
  return "sandy_beach_half_day";
}

function inferItineraryConstraints(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  return uniqueText([
    ...readStringArrayPath(deterministicSignals, ["intent", "tripContext", "durableConstraints"]),
    ...(/\bkids?|children|child|toddler|family|families\b/i.test(content) ? ["with kids"] : []),
    ...(/\bno\s+scooter|without\s+(?:a\s+)?scooter|avoid\s+scooters?|walk(?:ing)?\s+only\b/i.test(
      content,
    )
      ? ["avoid scooters"]
      : []),
    ...(/\bvegetarian|vegan|plant[-\s]?based|no\s+meat\b/i.test(content) ? ["vegetarian"] : []),
    ...(/\bquiet|calm|low[-\s]?key|not\s+crowded|avoid\s+crowds?|peaceful\b/i.test(content)
      ? ["quiet"]
      : []),
    ...(/\bnon[-\s]?surfer|not\s+surfing|avoid\s+surf|no\s+surf(?:ing)?\b/i.test(content)
      ? ["not surfing"]
      : []),
  ]);
}

function inferItineraryTransportMode(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
): LocalItineraryRequest["transport_mode"] | undefined {
  const signalTransportMode = readStringPath(deterministicSignals, [
    "intent",
    "tripContext",
    "transportMode",
  ]);
  if (isItineraryTransportMode(signalTransportMode)) {
    return signalTransportMode;
  }
  if (/\bwalk(?:ing)?|no\s+scooter|without\s+(?:a\s+)?scooter\b/i.test(content)) {
    return "walk";
  }
  if (/\bscooter|motorbike|motor\s*bike\b/i.test(content)) {
    return "scooter";
  }
  if (/\btricycle\b/i.test(content)) {
    return "tricycle";
  }
  if (/\bvan\b/i.test(content)) {
    return "van";
  }
  return undefined;
}

function inferItineraryDurationHours(content: string) {
  const numeric = content.match(/\b([234])[-\s]?(?:hour|hr)s?\b/i)?.[1];
  if (numeric) {
    return Number(numeric);
  }
  if (/\btwo[-\s]?(?:hour|hr)s?\b/i.test(content)) {
    return 2;
  }
  if (/\bthree[-\s]?(?:hour|hr)s?\b/i.test(content)) {
    return 3;
  }
  if (/\bfour[-\s]?(?:hour|hr)s?\b/i.test(content)) {
    return 4;
  }
  return undefined;
}

function inferMaxRideMinutes(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  const signalRideLimit = readNumberPath(deterministicSignals, [
    "intent",
    "tripContext",
    "rideTimeLimitMinutes",
  ]);
  if (signalRideLimit) {
    return signalRideLimit;
  }
  const rideLimit = content.match(/\b(\d{1,3})[-\s]?(?:minute|min)\b/i)?.[1];
  return rideLimit ? Number(rideLimit) : undefined;
}

function inferItineraryOrigin(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  const signalLocation =
    readStringPath(deterministicSignals, ["intent", "locationLabel"]) ??
    readStringPath(deterministicSignals, ["intent", "tripContext", "currentArea"]);
  if (signalLocation) {
    return signalLocation;
  }
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bdel\s+carmen|sugba\s+lagoon\b/i.test(content)) {
    return "Del Carmen";
  }
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  return undefined;
}

function inferMealPreference(content: string, constraints: readonly string[]) {
  if (/\bseafood\b/i.test(content)) {
    return "seafood";
  }
  if (/\bvegetarian|vegan|plant[-\s]?based|no\s+meat\b/i.test(content)) {
    return "vegetarian-friendly";
  }
  if (constraints.some((constraint) => /\bvegetarian\b/i.test(constraint))) {
    return "vegetarian-friendly";
  }
  return undefined;
}

function needsWeatherCheck(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  return (
    readBooleanPath(deterministicSignals, ["intent", "weatherSensitive"]) === true ||
    /\brainy|rain(?:ing)?|showers?|storm|weather|today|this\s+(?:morning|afternoon|evening)|sunset\b/i.test(
      content,
    )
  );
}

function needsOpenNowCheck(theme: LocalItineraryRequest["theme"], content: string) {
  return (
    theme === "food_crawl" ||
    theme === "sunset_plus_dinner" ||
    /\b(food|dinner|lunch|breakfast|brunch|caf[eé]s?|coffee|drinks?|bars?|open(?:[-\s]?now)?|hours?)\b/i.test(
      content,
    )
  );
}

function latestUserContent(messages: readonly AgentRuntimeRequest["messages"][number][]) {
  return messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
}

function hasSuccessfulItineraryPlanArtifact(
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  return (
    toolCalls.some(
      (toolCall) => toolCall.name === "plan_local_itinerary" && toolCall.status === "success",
    ) &&
    toolResults.some(
      (result) =>
        result.name === "plan_local_itinerary" &&
        result.status === "success" &&
        Boolean(result.itineraries?.length),
    )
  );
}

function missingRequiredItineraryChecks(
  toolResults: readonly AgentToolResult[],
  toolCalls: readonly AgentToolCallAudit[],
): ParsedFunctionCall[] {
  const missing: ParsedFunctionCall[] = [];
  const seen = new Set<string>();

  for (const result of toolResults) {
    const requiredToolChecks = readRequiredToolChecks(result.data);
    if (!requiredToolChecks) {
      continue;
    }

    if (requiredToolChecks.weather) {
      const argumentsForWeather = {
        location: requiredToolChecks.weather.location,
        date_range: requiredToolChecks.weather.date_range,
      };
      const key = requiredCheckKey("get_weather_forecast", argumentsForWeather);
      if (
        !seen.has(key) &&
        !hasMatchingToolCall(toolCalls, "get_weather_forecast", argumentsForWeather)
      ) {
        missing.push({
          callId: `auto_required_weather_${missing.length + 1}`,
          name: "get_weather_forecast",
          arguments: argumentsForWeather,
        });
        seen.add(key);
      }
    }

    for (const placesCheck of requiredToolChecks.places) {
      const argumentsForPlaces = {
        query: placesCheck.query,
        center: placesCheck.center,
        radius_meters: placesCheck.radius_meters,
        constraints: placesCheck.constraints,
      };
      const key = requiredCheckKey("search_places", argumentsForPlaces);
      if (!seen.has(key) && !hasMatchingToolCall(toolCalls, "search_places", argumentsForPlaces)) {
        missing.push({
          callId: `auto_required_places_${missing.length + 1}`,
          name: "search_places",
          arguments: argumentsForPlaces,
        });
        seen.add(key);
      }
    }
  }

  return missing;
}

function readRequiredToolChecks(data: AgentToolResult["data"]) {
  if (!isRecord(data) || !isRequiredToolChecks(data.requiredToolChecks)) {
    return undefined;
  }
  return data.requiredToolChecks;
}

function isRequiredToolChecks(value: unknown): value is ItineraryRequiredToolChecks {
  if (!isRecord(value) || !Array.isArray(value.places)) {
    return false;
  }
  if (
    value.weather !== undefined &&
    (!isRecord(value.weather) ||
      value.weather.tool !== "get_weather_forecast" ||
      typeof value.weather.location !== "string" ||
      typeof value.weather.date_range !== "string")
  ) {
    return false;
  }
  return value.places.every(
    (check) =>
      isRecord(check) &&
      check.tool === "search_places" &&
      typeof check.query === "string" &&
      isRecord(check.center) &&
      typeof check.center.latitude === "number" &&
      typeof check.center.longitude === "number" &&
      typeof check.radius_meters === "number" &&
      isRecord(check.constraints),
  );
}

function hasMatchingToolCall(
  toolCalls: readonly AgentToolCallAudit[],
  name: string,
  requiredArguments: Record<string, unknown>,
) {
  const requiredKey = normalizeRequiredToolArguments(requiredArguments);
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === name && normalizeRequiredToolArguments(toolCall.arguments) === requiredKey,
  );
}

function requiredCheckKey(name: string, requiredArguments: Record<string, unknown>) {
  return `${name}:${normalizeRequiredToolArguments(requiredArguments)}`;
}

function normalizeRequiredToolArguments(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => JSON.parse(normalizeRequiredToolArguments(item))));
  }
  if (!isRecord(value)) {
    return JSON.stringify(value ?? null);
  }

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [
          key,
          JSON.parse(normalizeRequiredToolArguments(nestedValue)),
        ]),
    ),
  );
}

async function executeAndAuditTool({
  executeTool,
  functionCall,
  logger,
  now,
  requestId,
}: {
  executeTool: (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;
  functionCall: ParsedFunctionCall;
  logger: ReturnType<typeof createComponentLogger>;
  now: () => Date;
  requestId: string;
}) {
  const startedAt = now();
  const result = await executeTool({
    requestId,
    toolCallId: functionCall.callId,
    name: functionCall.name,
    arguments: functionCall.arguments,
  });
  const resultWithToolCallId = {
    ...result,
    toolCallId: result.toolCallId ?? functionCall.callId,
  };
  const completedAt = now();
  const audit = createAgentToolCallAudit({
    toolCallId: functionCall.callId,
    name: functionCall.name,
    arguments: functionCall.arguments,
    result: resultWithToolCallId,
    startedAt,
    completedAt,
    providerOperation: providerOperationForTool(functionCall.name),
  });

  logger.info(
    {
      toolCallId: functionCall.callId,
      toolName: functionCall.name,
      durationMs: audit.durationMs,
      status: audit.status,
      errorCode: audit.errorCode,
      providerOperation: audit.providerOperation,
      sourceLabels: audit.sources.map((source) => source.label),
      sourceProfileIds: audit.sourceProfileIds,
    },
    "Ask Siargao agent tool call completed.",
  );

  return { audit, functionCall, result: resultWithToolCallId };
}

function extractFunctionCalls(output: unknown): ParsedFunctionCall[] {
  if (!Array.isArray(output)) {
    return [];
  }

  const calls: ParsedFunctionCall[] = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "function_call" || typeof item.name !== "string") {
      continue;
    }

    calls.push({
      callId: readString(item.call_id) ?? readString(item.id) ?? `call_${calls.length + 1}`,
      name: item.name,
      arguments: parseToolArguments(item.arguments),
    });
  }

  return calls;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeToolOutput(result: AgentToolResult) {
  return JSON.stringify({
    status: result.status,
    text: result.text,
    data: result.data,
    errorCode: result.errorCode,
    sources: result.sources,
  });
}

function collectUpstreamRequestId(requestId: string | undefined, upstreamRequestIds: string[]) {
  if (requestId) {
    upstreamRequestIds.push(requestId);
  }
}

function providerOperationForTool(name: string) {
  switch (name) {
    case "get_weather_forecast":
      return "open_meteo.forecast";
    case "get_condition_judgment":
      return "condition_judgment";
    case "search_places":
      return "google_places.search";
    case "get_place_details":
      return "google_places.details";
    case "search_local_guide":
      return "local_guide.search";
    case "plan_local_itinerary":
      return "local_itinerary.plan";
    case "describe_database_schema":
      return "local_data.schema";
    case "query_local_facts":
      return "local_data.query";
    case "get_source_evidence":
      return "local_data.evidence";
    case "describe_source_policy":
      return "source_policy.describe";
    case "search_agent_memory":
      return "agent_memory.search";
    default:
      return undefined;
  }
}

function sumDurations(toolCalls: readonly AgentToolCallAudit[]) {
  return toolCalls.reduce((total, toolCall) => total + toolCall.durationMs, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return readString(current);
}

function readNumberPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "number" ? current : undefined;
}

function readBooleanPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "boolean" ? current : undefined;
}

function readStringArrayPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return [];
    }
    current = current[segment];
  }
  return Array.isArray(current)
    ? current.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function isItineraryTransportMode(
  value: string | undefined,
): value is NonNullable<LocalItineraryRequest["transport_mode"]> {
  return value === "walk" || value === "scooter" || value === "tricycle" || value === "van";
}

function uniqueText(values: readonly string[]) {
  return [...new Set(values.map((value) => value.replaceAll(/\s+/g, " ").trim()).filter(Boolean))];
}

const responseContract = {
  tone: "practical local travel assistant",
  scope:
    "Answer only Siargao-related travel and local trip-planning questions. Politely decline unrelated questions.",
  sourceUse:
    "Use tool outputs as the only source for live weather, Google Places, curated local guide, and source-policy claims.",
  memoryRetrieval:
    "Use file_search or search_agent_memory for durable Ask Siargao policy/reference context. Memory retrieval is not live evidence and does not create checked source labels.",
  caveats:
    "Mention material unchecked fields from tool sources. Do not imply ratings, hours, tides, surf, bookings, availability, safety, or road conditions were checked unless a tool output says so.",
};

const askSiargaoBaseInstructions = [
  "You are Ask Siargao, a practical Siargao travel assistant.",
  "Answer the traveler's latest question directly and conversationally.",
  "Stay strictly scoped to Siargao Island, Siargao travel, and local trip-planning topics.",
  "If the latest question is unrelated to Siargao or plausible trip planning, politely decline and invite a Siargao-related question.",
  "Use the available tools whenever the answer needs current weather, Google Places facts, curated beach/local guide facts, safe local database facts, source evidence, or source-label policy.",
  "For condition questions about swimming, surfing, scooter rides, rain plans, sunset, or boat trips, call get_condition_judgment before the final answer and preserve unchecked tide, surf, road, current, lifeguard, and safety caveats.",
  "For 2-4 hour plan or itinerary requests, call plan_local_itinerary first, then write concise practical prose from the returned artifact instead of rendering a deterministic template.",
  "For rainy-day, today, weather-sensitive, or outdoor-exposure itineraries, call get_weather_forecast before the final answer and distinguish checked weather from unchecked surf, tide, road flooding, closures, and safety.",
  "For itinerary meal, cafe, drinks, dinner, or food-crawl stops that need venue identity, maps links, or open-now status, call search_places before the final answer and distinguish live/fresh-cache Places evidence from not-checked caveats.",
  "Do not invent live, provider-backed, or curated local facts. If a tool fails, explain what could not be checked and still give bounded practical guidance when possible.",
  "Treat Google Places ordering as provider relevance, not an independent quality ranking.",
  "Every Google Places place mentioned from tool output should include its raw Google Maps URL when present.",
  "For weather-sensitive or safety-sensitive plans, mention missing surf, swell, tides, road flooding, closures, and local safety checks when the tool did not check them.",
  "Keep answers concise and actionable.",
  "Do not frame Ask Siargao as a trip risk audit or paid report in chat answers.",
].join("\n");

function buildAskSiargaoAgentInstructions(memorySnapshot: AgentMemorySnapshot) {
  return [
    askSiargaoBaseInstructions,
    "Use the following loaded Ask Siargao agent memory as product behavior instructions.",
    memorySnapshot.instructionMarkdown,
  ].join("\n\n");
}

function createAgentMemoryMetadata(
  memorySnapshot: AgentMemorySnapshot,
  vectorStoreId: string | undefined,
): AgentMemoryMetadata {
  return {
    versionId: memorySnapshot.versionId,
    files: memorySnapshot.files.map((file) => ({
      id: file.id,
      title: file.title,
      fileName: file.fileName,
      relativePath: file.relativePath,
      role: file.role,
      checksum: file.checksum,
      byteLength: file.byteLength,
    })),
    ...(vectorStoreId ? { vectorStoreId } : {}),
  };
}

function summarizeMemoryForLogs(memory: AgentMemoryMetadata) {
  return {
    versionId: memory.versionId,
    ...(memory.vectorStoreId ? { vectorStoreId: memory.vectorStoreId } : {}),
    files: memory.files.map((file) => ({
      id: file.id,
      role: file.role,
      checksum: file.checksum,
      byteLength: file.byteLength,
    })),
  };
}

function summarizeMemoryForModel(memory: AgentMemoryMetadata): ModelFacingAgentMemoryMetadata {
  return {
    versionId: memory.versionId,
    files: memory.files.map((file) => ({
      id: file.id,
      role: file.role,
    })),
  };
}
