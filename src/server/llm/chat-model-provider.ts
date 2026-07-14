import OpenAI from "openai";

import {
  type ModelUsageMode,
  type NormalizedModelUsage,
  normalizeDeepSeekChatCompletionUsage,
  normalizeOpenAIResponsesUsage,
} from "@/server/llm/model-cost";

export type ResponsesCreateResult = {
  id?: string;
  output_text?: string;
  _request_id?: string;
  output?: unknown;
  model?: string;
  usage?: NormalizedModelUsage;
};

export type ResponsesClientLike = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<ResponsesCreateResult>;
  };
};

type ChatModelProviderOptions = {
  deepSeekApiKey?: string;
  deepSeekBaseUrl?: string;
  deepSeekClient?: ChatCompletionsClientLike;
  deepSeekModel?: string;
  openAiApiKey?: string;
  openAiClient?: ResponsesClientLike;
  openAiFallbackModel?: string;
  timeoutMs?: number;
};

type ChatCompletionsClientLike = {
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  };
};

const defaultDeepSeekBaseUrl = "https://api.deepseek.com";
export const defaultDeepSeekChatModel = "deepseek-v4-flash";
const defaultOpenAiFallbackChatModel = "gpt-5.4-mini";

export function resolvePrimaryChatModel(model?: string) {
  return model ?? process.env.DEEPSEEK_MODEL ?? defaultDeepSeekChatModel;
}

export function createConfiguredChatResponsesClient(
  options: ChatModelProviderOptions = {},
): ResponsesClientLike {
  const timeout = options.timeoutMs ?? 30_000;
  const deepSeekApiKey = options.deepSeekApiKey ?? process.env.DEEPSEEK_API_KEY;
  const openAiApiKey = options.openAiApiKey ?? process.env.OPENAI_API_KEY;
  const deepSeekModel = options.deepSeekModel ?? resolvePrimaryChatModel();
  const openAiFallbackModel =
    options.openAiFallbackModel ?? process.env.OPENAI_MODEL ?? defaultOpenAiFallbackChatModel;

  const primary =
    deepSeekApiKey || options.deepSeekClient
      ? createDeepSeekResponsesCompatibilityClient({
          apiKey: deepSeekApiKey,
          baseURL:
            options.deepSeekBaseUrl ?? process.env.DEEPSEEK_BASE_URL ?? defaultDeepSeekBaseUrl,
          client: options.deepSeekClient,
          model: deepSeekModel,
          timeout,
        })
      : undefined;
  const fallback =
    (options.openAiClient
      ? withOpenAIResponseModel(options.openAiClient, openAiFallbackModel)
      : undefined) ??
    (openAiApiKey
      ? createOpenAIResponsesFallbackClient({
          apiKey: openAiApiKey,
          model: openAiFallbackModel,
          timeout,
        })
      : undefined);

  if (!primary && !fallback) {
    throw new Error("DEEPSEEK_API_KEY or OPENAI_API_KEY is required for Ask Siargao chat.");
  }

  if (!primary) {
    return fallback as ResponsesClientLike;
  }

  if (!fallback) {
    return primary;
  }

  let useFallbackOnly = false;
  return {
    responses: {
      create: async (params) => {
        if (useFallbackOnly) {
          return fallback.responses.create(params);
        }

        try {
          return await primary.responses.create(params);
        } catch {
          useFallbackOnly = true;
          return fallback.responses.create(params);
        }
      },
    },
  };
}

function withOpenAIResponseModel(client: ResponsesClientLike, model: string): ResponsesClientLike {
  return {
    responses: {
      create: async (params) => {
        const response = await client.responses.create({
          ...params,
          model,
        });
        return {
          ...response,
          model: response.model ?? model,
          usage: normalizeOpenAIResponsesUsage({
            fallback: true,
            model,
            response: response as Record<string, unknown>,
          }),
        };
      },
    },
  };
}

function createOpenAIResponsesFallbackClient({
  apiKey,
  model,
  timeout,
}: {
  apiKey: string;
  model: string;
  timeout: number;
}): ResponsesClientLike {
  const client = new OpenAI({ apiKey, timeout }) as ResponsesClientLike;

  return {
    responses: {
      create: async (params) => {
        const response = await client.responses.create({
          ...params,
          model,
        });
        return {
          ...response,
          model: readString(response.model) ?? model,
          usage: normalizeOpenAIResponsesUsage({
            fallback: true,
            model,
            response: response as Record<string, unknown>,
          }),
        };
      },
    },
  };
}

function createDeepSeekResponsesCompatibilityClient({
  apiKey,
  baseURL,
  client: injectedClient,
  model,
  timeout,
}: {
  apiKey?: string;
  baseURL: string;
  client?: ChatCompletionsClientLike;
  model: string;
  timeout: number;
}): ResponsesClientLike {
  const client: ChatCompletionsClientLike =
    injectedClient ??
    (new OpenAI({
      apiKey: apiKey as string,
      baseURL,
      timeout,
    }) as unknown as ChatCompletionsClientLike);

  return {
    responses: {
      create: async (params) => {
        const requestedModel = readString(params.model) ?? model;
        const chatCompletionParams = responseParamsToChatCompletionParams(params, requestedModel);
        const response = await client.chat.completions.create(chatCompletionParams);
        return chatCompletionToResponseResult(response, requestedModel, {
          mode: modelUsageModeForDeepSeekRequest(chatCompletionParams),
        });
      },
    },
  };
}

function responseParamsToChatCompletionParams(params: Record<string, unknown>, model: string) {
  const tools = responseToolsToChatTools(params.tools);
  const body: Record<string, unknown> = {
    model,
    messages: responseInputToChatMessages(params.instructions, params.input),
    stream: false,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  };
  const maxOutputTokens = readNumber(params.max_output_tokens);
  if (maxOutputTokens !== undefined) {
    body.max_tokens = maxOutputTokens;
  }
  if (tools.length > 0) {
    body.tools = tools;
  }
  const responseFormat = responseFormatForDeepSeek(params.text);
  if (responseFormat) {
    body.response_format = responseFormat;
  }
  return body;
}

function responseInputToChatMessages(instructions: unknown, input: unknown) {
  const messages: Array<Record<string, unknown>> = [];
  const instructionsText = instructionText(instructions);
  if (instructionsText) {
    messages.push({ role: "system", content: instructionsText });
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    messages.push(...responseInputItemsToChatMessages(input));
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "" });
  }

  return messages;
}

function responseInputItemsToChatMessages(items: readonly unknown[]) {
  const messages: Array<Record<string, unknown>> = [];
  let pendingToolCalls: Array<Record<string, unknown>> = [];
  let pendingToolReasoningContent: string | undefined;
  let pendingToolContent: string | undefined;

  const flushPendingToolCalls = () => {
    if (pendingToolCalls.length === 0) {
      return;
    }
    messages.push({
      role: "assistant",
      content: pendingToolContent ?? "",
      tool_calls: pendingToolCalls,
      ...(pendingToolReasoningContent ? { reasoning_content: pendingToolReasoningContent } : {}),
    });
    pendingToolCalls = [];
    pendingToolReasoningContent = undefined;
    pendingToolContent = undefined;
  };

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "function_call") {
      pendingToolCalls.push({
        id:
          readString(item.call_id) ?? readString(item.id) ?? `call_${pendingToolCalls.length + 1}`,
        type: "function",
        function: {
          name: readString(item.name) ?? "",
          arguments: readString(item.arguments) ?? "{}",
        },
      });
      pendingToolReasoningContent =
        pendingToolReasoningContent ?? readString(item.reasoning_content);
      pendingToolContent = pendingToolContent ?? readString(item.content);
      continue;
    }

    flushPendingToolCalls();

    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: readString(item.call_id) ?? readString(item.id) ?? "",
        content: readString(item.output) ?? "",
      });
      continue;
    }

    if (item.type === "message") {
      const role = chatMessageRole(item.role);
      if (!role) {
        continue;
      }
      messages.push({
        role,
        content: contentText(item.content),
      });
    }
  }

  flushPendingToolCalls();
  return messages;
}

function responseToolsToChatTools(tools: unknown) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.flatMap((tool) => {
    if (!isRecord(tool) || tool.type !== "function") {
      return [];
    }
    const name = readString(tool.name);
    if (!name) {
      return [];
    }
    return [
      {
        type: "function",
        function: {
          name,
          description: readString(tool.description) ?? "",
          parameters: isRecord(tool.parameters) ? tool.parameters : { type: "object" },
        },
      },
    ];
  });
}

function chatCompletionToResponseResult(
  response: Record<string, unknown>,
  requestedModel: string,
  {
    mode,
  }: {
    mode: ModelUsageMode;
  },
): ResponsesCreateResult {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = choices.find(isRecord);
  const message = isRecord(firstChoice?.message) ? firstChoice.message : {};
  const content = contentText(message.content).trim();
  const nativeToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const dsmlToolCalls = nativeToolCalls.length === 0 ? parseDeepSeekDsmlToolCalls(content) : [];
  const toolCalls = nativeToolCalls.length > 0 ? nativeToolCalls : dsmlToolCalls;
  const toolCallContent = dsmlToolCalls.length > 0 ? "" : content;
  const reasoningContent = readString(message.reasoning_content);
  const output = toolCalls.length
    ? toolCalls.flatMap((toolCall, index) =>
        chatToolCallToResponseOutput(toolCall, index, {
          content: toolCallContent,
          reasoningContent,
        }),
      )
    : content
      ? [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: content }],
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          },
        ]
      : [];

  return {
    id: readString(response.id),
    _request_id: readString(response._request_id) ?? readString(response.id),
    output,
    ...(toolCalls.length === 0 && content ? { output_text: content } : {}),
    model: readString(response.model) ?? requestedModel,
    usage: normalizeDeepSeekChatCompletionUsage({
      mode,
      requestedModel,
      response,
    }),
  };
}

function modelUsageModeForDeepSeekRequest(params: Record<string, unknown>): ModelUsageMode {
  const thinking = isRecord(params.thinking) ? params.thinking : undefined;
  if (thinking?.type === "enabled" && params.reasoning_effort === "high") {
    return "thinking_high";
  }
  if (thinking?.type === "disabled") {
    return "thinking_disabled";
  }
  return "unknown";
}

function chatToolCallToResponseOutput(
  toolCall: unknown,
  index: number,
  {
    content,
    reasoningContent,
  }: {
    content: string;
    reasoningContent?: string;
  },
) {
  if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
    return [];
  }
  const callId = readString(toolCall.id) ?? `call_${index + 1}`;
  return [
    {
      type: "function_call",
      id: callId,
      call_id: callId,
      name: readString(toolCall.function.name) ?? "",
      arguments: readString(toolCall.function.arguments) ?? "{}",
      ...(content ? { content } : {}),
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    },
  ];
}

function parseDeepSeekDsmlToolCalls(content: string): Array<Record<string, unknown>> {
  if (!content.includes("DSML") || !content.includes("tool_calls")) {
    return [];
  }

  const toolCallsBlock =
    /<\s*[|｜]{2}DSML[|｜]{2}tool_calls\s*>([\s\S]*?)<\s*\/\s*[|｜]{2}DSML[|｜]{2}tool_calls\s*>/u.exec(
      content,
    )?.[1];
  if (!toolCallsBlock) {
    return [];
  }

  return Array.from(
    toolCallsBlock.matchAll(
      /<\s*[|｜]{2}DSML[|｜]{2}invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\s*\/\s*[|｜]{2}DSML[|｜]{2}invoke\s*>/gu,
    ),
  ).flatMap((match, index) => {
    const name = match[1]?.trim();
    const body = match[2] ?? "";
    if (!name) {
      return [];
    }

    const argumentsObject = normalizeDeepSeekDsmlToolArguments(
      name,
      parseDeepSeekDsmlParameters(body),
    );

    return [
      {
        id: `dsml_call_${index + 1}`,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(argumentsObject),
        },
      },
    ];
  });
}

function parseDeepSeekDsmlParameters(body: string) {
  const parameters: Record<string, unknown> = {};
  for (const match of body.matchAll(
    /<\s*[|｜]{2}DSML[|｜]{2}parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\s*\/\s*[|｜]{2}DSML[|｜]{2}parameter\s*>/gu,
  )) {
    const name = match[1]?.trim();
    if (!name) {
      continue;
    }
    parameters[name] = parseDeepSeekDsmlParameterValue(match[2]?.trim() ?? "");
  }
  return parameters;
}

function parseDeepSeekDsmlParameterValue(value: string): unknown {
  if (!value) {
    return "";
  }
  if (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeDeepSeekDsmlToolArguments(name: string, args: Record<string, unknown>) {
  if (name !== "load_agent_memory_file" || Array.isArray(args.documents)) {
    return args;
  }

  const document = readString(args.file_id) ?? readString(args.file) ?? readString(args.document);
  if (!document) {
    return args;
  }

  const { file_id: _fileId, file: _file, document: _document, ...rest } = args;
  return {
    ...rest,
    documents: [document],
  };
}

function responseFormatForDeepSeek(text: unknown) {
  if (!isRecord(text) || !isRecord(text.format)) {
    return undefined;
  }
  return text.format.type === "json_schema" ? { type: "json_object" } : undefined;
}

function instructionText(instructions: unknown) {
  if (typeof instructions === "string") {
    return instructions;
  }
  if (!Array.isArray(instructions)) {
    return undefined;
  }
  return instructions
    .flatMap((instruction) => {
      const text = contentText(instruction);
      return text ? [text] : [];
    })
    .join("\n");
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }
      const text = readString(part.text) ?? readString(part.content);
      return text ? [text] : [];
    })
    .join("\n");
}

function chatMessageRole(role: unknown) {
  return role === "user" || role === "assistant" || role === "system" ? role : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
