import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import type {
  AgentToolExecutionRequest,
  AgentToolResult,
  AskSiargaoAgentToolName,
} from "@/server/chat/agent-runtime";
import {
  type AgentResponseToolDefinition,
  type AgentToolDefinition,
  type AgentToolDependencies,
  composeAgentToolFamilies,
} from "@/server/chat/agent-tool-catalogue";
import { createConditionToolFamily } from "@/server/chat/agent-tool-condition-family";
import { createGooglePlacesToolFamily } from "@/server/chat/agent-tool-google-places-family";
import { createLocalToolFamily } from "@/server/chat/agent-tool-local-family";
import {
  createMemoryToolFamily,
  memoryToolDefinitionForSnapshot,
} from "@/server/chat/agent-tool-memory-family";
import { createNightlifeToolFamily } from "@/server/chat/agent-tool-nightlife-family";
import { createSourcePolicyToolFamily } from "@/server/chat/agent-tool-source-policy-family";
import { uniqueText } from "@/server/chat/agent-tool-utils";
import { createWebResearchToolFamily } from "@/server/chat/agent-tool-web-research-family";

export type {
  AgentHostedToolDefinition,
  AgentResponseToolDefinition,
  AgentToolDefinition,
  AgentToolDependencies,
  WebPageFetchProvider,
} from "@/server/chat/agent-tool-catalogue";

/**
 * The catalogue is intentionally composition-only. Tool-family modules own their
 * schemas, normalization, handlers, source policy, and public artifacts.
 */
export const agentToolFamilies = [
  createConditionToolFamily(),
  createWebResearchToolFamily(),
  createNightlifeToolFamily(),
  createGooglePlacesToolFamily(),
  createLocalToolFamily(),
  createSourcePolicyToolFamily(),
  createMemoryToolFamily(),
] as const;

const registeredTools = composeAgentToolFamilies(agentToolFamilies);
const defaultFunctionToolNames = agentToolFamilies.flatMap((family) => family.toolNames);

export const agentToolDefinitions = defaultFunctionToolNames.map(
  (name) => registeredTools[name]?.definition as AgentToolDefinition,
);

export function buildAgentResponseTools(
  memorySnapshot: AgentMemorySnapshot,
  options: {
    forceMemoryFallback?: boolean;
    includeMemoryFallbackWithFileSearch?: boolean;
    vectorStoreId?: string;
  } = {},
): AgentResponseToolDefinition[] {
  const tools: AgentResponseToolDefinition[] = defaultFunctionToolNames.map((name) =>
    name === "load_agent_memory_file"
      ? memoryToolDefinitionForSnapshot(
          registeredTools[name]?.definition as AgentToolDefinition,
          memorySnapshot,
        )
      : (registeredTools[name]?.definition as AgentToolDefinition),
  );
  const vectorStoreId = options.vectorStoreId ?? process.env.OPENAI_AGENT_MEMORY_VECTOR_STORE_ID;
  if (vectorStoreId) {
    tools.push({
      type: "file_search",
      vector_store_ids: [vectorStoreId],
      max_num_results: 5,
    });
  }

  if (
    !vectorStoreId ||
    options.forceMemoryFallback ||
    options.includeMemoryFallbackWithFileSearch
  ) {
    const memorySearch = memoryToolDefinitionForSnapshot(
      registeredTools.search_agent_memory?.definition as AgentToolDefinition,
      memorySnapshot,
    );
    if (memorySearch) {
      tools.push(memorySearch);
    }
  }

  return tools;
}

export function describeAvailableTools() {
  return agentToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export async function executeAgentTool(
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies = {},
): Promise<AgentToolResult> {
  const tool = registeredTools[request.name as AskSiargaoAgentToolName];
  if (!tool) {
    return {
      name: request.name,
      status: "error",
      text: `Unknown Ask Siargao agent tool: ${request.name}.`,
      errorCode: "unknown_tool",
      sources: [],
    };
  }

  const argumentsWithDefaults = applyArgumentDefaults(request.arguments, tool.argumentDefaults);
  const requestForValidation =
    argumentsWithDefaults === request.arguments
      ? request
      : { ...request, arguments: argumentsWithDefaults };
  const parsed = tool.schema.safeParse(
    tool.argumentsForValidation?.(requestForValidation) ?? argumentsWithDefaults,
  );
  if (!parsed.success) {
    const argumentKeys = Object.keys(request.arguments).sort();
    const invalidArguments = {
      keys: argumentKeys,
      types: Object.fromEntries(
        argumentKeys.map((key) => [key, safeArgumentType(request.arguments[key])]),
      ),
    };
    const validationIssues = parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "<root>",
      code: issue.code,
    }));
    const invalidPaths = uniqueText(validationIssues.map((issue) => issue.path));
    return {
      name: request.name,
      status: "error",
      text: `Invalid arguments for ${request.name}: ${invalidPaths.join(", ")}.`,
      logData: { invalidArguments, validationIssues },
      errorCode: "invalid_tool_arguments",
      sources: [],
    };
  }

  try {
    return await tool.execute(parsed.data, request, dependencies);
  } catch {
    return {
      name: request.name,
      status: "error",
      text: safeToolExecutionFailureText(request.name),
      errorCode: "tool_execution_failed",
      sources: [],
    };
  }
}

function applyArgumentDefaults(
  args: Record<string, unknown>,
  defaults: Readonly<Record<string, unknown>> | undefined,
) {
  if (!defaults) {
    return args;
  }
  const normalized = { ...args };
  for (const [key, value] of Object.entries(defaults)) {
    if (normalized[key] === undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function safeArgumentType(value: unknown) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function safeToolExecutionFailureText(toolName: string) {
  return `${toolName} failed before it could return safe data.`;
}
