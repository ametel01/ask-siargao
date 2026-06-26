import { z } from "zod";

import type {
  AgentToolExecutionRequest,
  AgentToolResult,
  AskSiargaoAgentToolName,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";

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

type ToolHandler<Arguments> = (
  args: Arguments,
  request: AgentToolExecutionRequest,
) => Promise<AgentToolResult> | AgentToolResult;

type RegisteredTool<Arguments> = {
  definition: AgentToolDefinition;
  schema: z.ZodType<Arguments>;
  execute: ToolHandler<Arguments>;
};

type SourcePolicyDescription = {
  label: AnswerTrustLabel;
  meaning: string;
  useWhen: string;
  caveats: string[];
};

type SourcePolicyToolData = {
  policies: SourcePolicyDescription[];
};

const describeSourcePolicySchema = z.object({}).strict();

const sourcePolicyDescriptions: SourcePolicyDescription[] = [
  {
    label: "live_checked",
    meaning: "A live Google Places lookup returned current allowed place fields.",
    useWhen:
      "Use for live Places search/detail outputs with allowed identity, rating, hours, price, contact, and map-link fields.",
    caveats: [
      "Google Places order is provider relevance, not an independent quality ranking.",
      "Review text, bookings, table availability, room availability, and local quality checks are not included.",
    ],
  },
  {
    label: "fresh_cache",
    meaning: "Fresh reusable Google Places cache rows backed the answer.",
    useWhen:
      "Use for cached Places facts that are still inside the configured freshness and retention windows.",
    caveats: [
      "Cached rows still require Google attribution and retention handling.",
      "Do not imply live open-now status unless that field was present and fresh.",
    ],
  },
  {
    label: "curated_local_guide",
    meaning: "Ask Siargao curated local guide data backed the answer.",
    useWhen: "Use for local beach and trip-planning facts maintained by Ask Siargao.",
    caveats: [
      "Tides, currents, road conditions, access changes, and lifeguard or safety status are not live checked.",
    ],
  },
  {
    label: "weather_checked",
    meaning: "Open-Meteo forecast data backed the weather or activity-planning answer.",
    useWhen: "Use when a usable live or stored Open-Meteo snapshot was available for the request.",
    caveats: [
      "Surf, swell, tides, road flooding, local closures, and provider-independent safety checks are not included.",
    ],
  },
  {
    label: "not_verified",
    meaning:
      "The answer uses generic model reasoning or stable context without a matching live/local tool output.",
    useWhen:
      "Use whenever no backend tool actually checked the specific live, cached, weather, or curated fact.",
    caveats: [
      "Never label generic model reasoning as live checked, fresh cache, weather checked, or curated local guide.",
    ],
  },
  {
    label: "provider_unavailable",
    meaning: "A provider or cache lookup needed for the answer failed or was unavailable.",
    useWhen:
      "Use when Google Places, Open-Meteo, or another backend provider could not return usable data.",
    caveats: [
      "Explain the missing check plainly and avoid fabricating provider-backed facts from model knowledge.",
    ],
  },
];

const sourcePolicySummaries: AnswerSourceSummary[] = [
  {
    label: "live_checked",
    sourceName: "Google Places",
    sourceProfileId: "source_google_places",
    confidence: "high",
    checked: [
      "allowed live place identity, address, rating, hours, price, contact, and map-link fields when returned",
    ],
    notChecked: [
      "review text",
      "bookings",
      "table availability",
      "room availability",
      "independent local quality checks",
    ],
  },
  {
    label: "fresh_cache",
    sourceName: "Google Places",
    sourceProfileId: "source_google_places",
    confidence: "medium",
    checked: ["fresh cached allowed place fields inside retention windows"],
    notChecked: ["live open-now status when absent from the cached row", "review text", "bookings"],
  },
  {
    label: "curated_local_guide",
    sourceName: "Ask Siargao curated local guide",
    confidence: "medium",
    checked: ["curated beach and local trip-planning notes"],
    notChecked: [
      "live tides",
      "currents",
      "road conditions",
      "access changes",
      "lifeguard or safety status",
    ],
  },
  {
    label: "weather_checked",
    sourceName: "Open-Meteo weather API",
    sourceProfileId: "source_open_meteo",
    confidence: "medium",
    checked: ["forecast snapshots for Siargao locations"],
    notChecked: ["surf reports", "tides", "road flooding", "local closures"],
  },
  {
    label: "not_verified",
    sourceName: "Generic model reasoning",
    confidence: "low",
    checked: [],
    notChecked: [
      "live Google Places",
      "fresh cached Google Places",
      "Open-Meteo weather forecast",
      "curated local guide checks",
    ],
  },
  {
    label: "provider_unavailable",
    sourceName: "Backend provider",
    confidence: "low",
    checked: [],
    notChecked: ["the requested provider lookup"],
  },
];

const registeredTools: Partial<Record<AskSiargaoAgentToolName, RegisteredTool<unknown>>> = {
  describe_source_policy: {
    definition: {
      type: "function",
      name: "describe_source_policy",
      description:
        "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      strict: true,
    },
    schema: describeSourcePolicySchema,
    execute: () => ({
      name: "describe_source_policy",
      status: "success",
      text: renderSourcePolicyText(sourcePolicyDescriptions),
      data: {
        policies: sourcePolicyDescriptions,
      } satisfies SourcePolicyToolData,
      sources: sourcePolicySummaries,
    }),
  },
};

export const agentToolDefinitions = Object.values(registeredTools).map((tool) => tool.definition);

export function describeAvailableTools() {
  return agentToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export async function executeAgentTool(
  request: AgentToolExecutionRequest,
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

  const parsed = tool.schema.safeParse(request.arguments);
  if (!parsed.success) {
    return {
      name: request.name,
      status: "error",
      text: `Invalid arguments for ${request.name}: ${parsed.error.issues
        .map((issue: { message: string }) => issue.message)
        .join("; ")}`,
      errorCode: "invalid_tool_arguments",
      sources: [],
    };
  }

  try {
    return await tool.execute(parsed.data, request);
  } catch (error) {
    return {
      name: request.name,
      status: "error",
      text:
        error instanceof Error ? error.message : `${request.name} failed with an unknown error.`,
      errorCode: "tool_execution_failed",
      sources: [],
    };
  }
}

function renderSourcePolicyText(policies: readonly SourcePolicyDescription[]) {
  return [
    "Ask Siargao source policy labels:",
    ...policies.map(
      (policy) =>
        `- ${policy.label}: ${policy.meaning} Use when: ${policy.useWhen} Caveats: ${policy.caveats.join(" ")}`,
    ),
  ].join("\n");
}
