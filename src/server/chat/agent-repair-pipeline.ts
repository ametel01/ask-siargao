import type {
  AgentResponsesClient,
  AgentResponsesCreateResult,
  AgentToolCallAudit,
  AgentToolResult,
} from "@/server/chat/agent-runtime";

export type AgentRepairFunctionCall = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentRepairToolOutput = {
  audit: AgentToolCallAudit;
  functionCall: AgentRepairFunctionCall;
  result: AgentToolResult;
};

export type AgentRepairAdapterContext = {
  finalText: string;
  responseInput: readonly ResponseInputItem[];
  toolCalls: readonly AgentToolCallAudit[];
  toolResults: readonly AgentToolResult[];
};

type ResponseInputItem = Record<string, unknown>;

type ToolRepairPayload = {
  type: "tool";
  functionCalls: readonly AgentRepairFunctionCall[];
  instruction: string;
  payloadKey: string;
  payload?: (outputs: readonly AgentRepairToolOutput[]) => unknown;
  maxOutputTokens?: number;
};

type RetryRepairPayload = {
  type: "retry";
  instruction: string;
  payloadKey?: string;
  payload?: unknown;
  maxOutputTokens?: number;
};

export type AgentRepairPayload = ToolRepairPayload | RetryRepairPayload;

export type AgentRepairAdapter = {
  name: string;
  createRepair: (context: AgentRepairAdapterContext) => AgentRepairPayload | undefined;
};

export type AgentRepairPipelineResult =
  | {
      repaired: false;
    }
  | {
      repaired: true;
      response: AgentResponsesCreateResult;
      responseInput: ResponseInputItem[];
      adapterName: string;
    };

export type RunAgentRepairPipelineOptions = {
  adapters: readonly AgentRepairAdapter[];
  client: AgentResponsesClient;
  executeToolCalls: (
    functionCalls: readonly AgentRepairFunctionCall[],
  ) => Promise<readonly AgentRepairToolOutput[]>;
  finalText: string;
  instructions: string;
  maxToolCalls: number;
  model: string;
  response: AgentResponsesCreateResult;
  responseInclude?: readonly string[];
  responseInput: readonly ResponseInputItem[];
  responseTools: readonly unknown[];
  responseContract: unknown;
  collectHostedMemory: (response: AgentResponsesCreateResult) => void;
  collectUpstreamRequestId: (requestId: string | undefined) => void;
  serializeToolOutput: (result: AgentToolResult) => string;
  publicToolArguments: (functionCall: AgentRepairFunctionCall) => Record<string, unknown>;
  toolCalls: AgentToolCallAudit[];
  toolResults: AgentToolResult[];
};

export async function runAgentRepairPipeline({
  adapters,
  client,
  collectHostedMemory,
  collectUpstreamRequestId,
  executeToolCalls,
  finalText,
  instructions,
  maxToolCalls,
  model,
  publicToolArguments,
  response,
  responseContract,
  responseInclude,
  responseInput,
  responseTools,
  serializeToolOutput,
  toolCalls,
  toolResults,
}: RunAgentRepairPipelineOptions): Promise<AgentRepairPipelineResult> {
  for (const adapter of adapters) {
    const repair = adapter.createRepair({
      finalText,
      responseInput,
      toolCalls,
      toolResults,
    });
    if (!repair) {
      continue;
    }

    const retryInput = [...responseInput, ...responseOutputItems(response.output)];
    if (repair.type === "tool") {
      if (toolCalls.length + repair.functionCalls.length > maxToolCalls) {
        if (hasToolBudgetExhaustedRepairInput(responseInput, adapter.name)) {
          continue;
        }

        retryInput.push(
          repairUserInputMessage({
            instruction:
              "Validation repair: the model requested more tool calls, but the Ask Siargao tool-call budget is exhausted. Do not call tools. Return the best final traveler-facing answer now using only checked evidence already present in the conversation. Do not invent live/current facts. If a required check is missing or unavailable, say that plainly as a caveat and omit checked/live/source claims and public artifacts that depend on it.",
            validationRepairToolBudgetExhausted: {
              adapterName: adapter.name,
              requestedToolCalls: repair.functionCalls.map((functionCall) => ({
                name: functionCall.name,
                arguments: publicToolArguments(functionCall),
              })),
              existingToolCallCount: toolCalls.length,
              maxToolCalls,
            },
            responseContract,
          }),
        );

        const retryResponse = await client.responses.create({
          model,
          store: false,
          max_output_tokens: repair.maxOutputTokens ?? 3_000,
          instructions,
          input: retryInput,
        });
        collectUpstreamRequestId(retryResponse._request_id);
        collectHostedMemory(retryResponse);

        return {
          repaired: true,
          response: retryResponse,
          responseInput: retryInput,
          adapterName: adapter.name,
        };
      }

      const outputs = await executeToolCalls(repair.functionCalls);
      toolCalls.push(...outputs.map((output) => output.audit));
      toolResults.push(...outputs.map((output) => output.result));
      retryInput.push(
        repairUserInputMessage({
          instruction: repair.instruction,
          [repair.payloadKey]: repair.payload
            ? repair.payload(outputs)
            : outputs.map((output) =>
                repairToolOutputPayload(output, publicToolArguments, serializeToolOutput),
              ),
          responseContract,
        }),
      );
    } else {
      retryInput.push(
        repairUserInputMessage({
          instruction: repair.instruction,
          ...(repair.payloadKey ? { [repair.payloadKey]: repair.payload } : {}),
          responseContract,
        }),
      );
    }

    const retryResponse = await client.responses.create({
      model,
      store: false,
      max_output_tokens: repair.maxOutputTokens ?? 3_000,
      instructions,
      tools: responseTools,
      ...(responseInclude ? { include: responseInclude } : {}),
      input: retryInput,
    });
    collectUpstreamRequestId(retryResponse._request_id);
    collectHostedMemory(retryResponse);

    return {
      repaired: true,
      response: retryResponse,
      responseInput: retryInput,
      adapterName: adapter.name,
    };
  }

  return { repaired: false };
}

function repairUserInputMessage(input: Record<string, unknown>): ResponseInputItem {
  return {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text: JSON.stringify({
          product: "Ask Siargao",
          ...input,
        }),
      },
    ],
  };
}

function responseOutputItems(output: unknown): ResponseInputItem[] {
  if (!Array.isArray(output)) {
    return [];
  }

  return output.flatMap((item) => (isRecord(item) ? [item] : []));
}

function hasToolBudgetExhaustedRepairInput(
  responseInput: readonly ResponseInputItem[],
  adapterName: string,
) {
  return responseInput.some((item) => {
    const content = item.content;
    if (!Array.isArray(content)) {
      return false;
    }
    return content.some((entry) => {
      if (!isRecord(entry) || typeof entry.text !== "string") {
        return false;
      }
      const parsed = parseJsonRecord(entry.text);
      const exhaustedRepair = parsed?.validationRepairToolBudgetExhausted;
      return (
        isRecord(exhaustedRepair) &&
        typeof exhaustedRepair.adapterName === "string" &&
        exhaustedRepair.adapterName === adapterName
      );
    });
  });
}

function repairToolOutputPayload(
  output: AgentRepairToolOutput,
  publicToolArguments: (functionCall: AgentRepairFunctionCall) => Record<string, unknown>,
  serializeToolOutput: (result: AgentToolResult) => string,
) {
  return {
    toolCallId: output.functionCall.callId,
    name: output.functionCall.name,
    arguments: publicToolArguments(output.functionCall),
    result: JSON.parse(serializeToolOutput(output.result)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
