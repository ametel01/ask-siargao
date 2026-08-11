import type { z } from "zod";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import type {
  AgentToolExecutionRequest,
  AgentToolResult,
  AskSiargaoAgentToolName,
} from "@/server/chat/agent-runtime";
import type { LocalFactsQueryRunner } from "@/server/chat/local-data-tools";
import type {
  PlacesEvidenceAdapter,
  PlacesEvidenceAdapterDependencies,
} from "@/server/providers/google-places-evidence";
import type { buildOpenMeteoMarineIngestionBatch } from "@/server/providers/open-meteo-marine";
import type { buildTideForecastSnapshot } from "@/server/providers/tide-forecast";
import type { WebResearchSearchProvider } from "@/server/providers/web-search";
import type { getLatestSiargaoWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

export type AgentToolDefinition = {
  type: "function";
  name: AskSiargaoAgentToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties: false;
  };
  strict: true;
};

export type AgentHostedToolDefinition = {
  type: "file_search";
  vector_store_ids: readonly string[];
  max_num_results?: number;
};

export type AgentResponseToolDefinition = AgentToolDefinition | AgentHostedToolDefinition;

export type WebPageFetchProvider = (input: {
  url: string;
  requestId: string;
}) => Promise<{ url: string; title: string; pageSummary: string; publishedOrUpdatedAt?: string }>;

export type AgentToolDependencies = PlacesEvidenceAdapterDependencies & {
  placesEvidenceAdapter?: PlacesEvidenceAdapter;
  buildOpenMeteoMarineIngestionBatch?: typeof buildOpenMeteoMarineIngestionBatch;
  buildTideForecastSnapshot?: typeof buildTideForecastSnapshot;
  getLatestSiargaoWeatherSnapshot?: typeof getLatestSiargaoWeatherSnapshot;
  localFactsQueryRunner?: LocalFactsQueryRunner;
  localFactsQueryTimeoutMs?: number;
  memorySnapshot?: AgentMemorySnapshot;
  now?: () => Date;
  webPageFetcher?: WebPageFetchProvider;
  webResearchProvider?: WebResearchSearchProvider;
};

export type ToolHandler<Arguments> = (
  args: Arguments,
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies,
) => Promise<AgentToolResult> | AgentToolResult;

export type RegisteredTool<Arguments> = {
  definition: AgentToolDefinition;
  schema: z.ZodType<Arguments>;
  execute: ToolHandler<Arguments>;
  argumentDefaults?: Readonly<Record<string, unknown>>;
  argumentsForValidation?: (request: AgentToolExecutionRequest) => unknown;
};

export type AgentToolFamily = {
  id: string;
  /** Tool names exposed in the default Responses function list, in model-facing order. */
  toolNames: readonly AskSiargaoAgentToolName[];
  tools: Partial<Record<AskSiargaoAgentToolName, RegisteredTool<unknown>>>;
};

export function defineTool<Arguments>(tool: RegisteredTool<Arguments>): RegisteredTool<unknown> {
  return tool as RegisteredTool<unknown>;
}

export function composeAgentToolFamilies(
  families: readonly AgentToolFamily[],
): Partial<Record<AskSiargaoAgentToolName, RegisteredTool<unknown>>> {
  const registry: Partial<Record<AskSiargaoAgentToolName, RegisteredTool<unknown>>> = {};
  const registeredNames = new Set<AskSiargaoAgentToolName>();

  for (const family of families) {
    for (const [rawName, tool] of Object.entries(family.tools)) {
      const name = rawName as AskSiargaoAgentToolName;
      if (registeredNames.has(name)) {
        throw new Error(`Duplicate Ask Siargao agent tool registration: ${name}.`);
      }
      if (!tool) {
        throw new Error(`Agent tool family ${family.id} did not provide ${name}.`);
      }
      registry[name] = tool;
      registeredNames.add(name);
    }
    for (const name of family.toolNames) {
      if (!family.tools[name]) {
        throw new Error(`Agent tool family ${family.id} did not provide ${name}.`);
      }
    }
  }

  return registry;
}
