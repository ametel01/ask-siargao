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
        throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
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
