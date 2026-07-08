import { z } from "zod";
import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import { requiredAgentMemoryManifest } from "@/server/chat/agent-memory";
import {
  type AgentToolDefinition,
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { isRecord, optionalNullable } from "@/server/chat/agent-tool-utils";

const agentMemoryReferenceDocumentNames = requiredAgentMemoryManifest.reduce<string[]>(
  (names, entry) => {
    if (entry.role === "reference") {
      names.push(entry.fileName);
    }
    return names;
  },
  [],
) as [string, ...string[]];
const agentMemoryLoadableDocumentNames = agentMemoryReferenceDocumentNames;

const searchAgentMemorySchema = z.strictObject({
  query: z.string().trim().min(2).max(240),
  documents: optionalNullable(z.array(z.enum(agentMemoryReferenceDocumentNames)).min(1).max(5)),
  max_results: optionalNullable(z.number().int().min(1).max(5)),
});
const loadAgentMemoryFileSchema = z.strictObject({
  documents: z.array(z.enum(agentMemoryLoadableDocumentNames)).min(1).max(3),
});

export type SearchAgentMemoryArguments = z.infer<typeof searchAgentMemorySchema>;
export type LoadAgentMemoryFileArguments = z.infer<typeof loadAgentMemoryFileSchema>;

export type MemoryToolHandlers = {
  searchAgentMemory: ToolHandler<SearchAgentMemoryArguments>;
  loadAgentMemoryFile: ToolHandler<LoadAgentMemoryFileArguments>;
};

export function createMemoryToolFamily(handlers: MemoryToolHandlers): AgentToolFamily {
  return {
    id: "memory",
    toolNames: ["load_agent_memory_file"],
    tools: {
      search_agent_memory: defineTool({
        definition: {
          type: "function",
          name: "search_agent_memory",
          description:
            "Search durable Ask Siargao agent memory references such as the data dictionary, source policy, and local assumptions. This is policy/reference context, not live evidence.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Natural-language memory search query.",
              },
              documents: {
                type: ["array", "null"],
                items: {
                  type: "string",
                  enum: agentMemoryReferenceDocumentNames,
                },
                description: "Optional subset of agent-memory reference documents to search.",
              },
              max_results: {
                type: ["integer", "null"],
                minimum: 1,
                maximum: 5,
                description: "Maximum number of reference excerpts to return.",
              },
            },
            required: ["query", "documents", "max_results"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: searchAgentMemorySchema,
        execute: handlers.searchAgentMemory,
      }),
      load_agent_memory_file: defineTool({
        definition: {
          type: "function",
          name: "load_agent_memory_file",
          description:
            "Load exact Ask Siargao agent-memory reference files by filename after using INDEX.md to choose the smallest relevant set. This is policy/reference context, not live evidence.",
          parameters: {
            type: "object",
            properties: {
              documents: {
                type: "array",
                items: {
                  type: "string",
                  enum: agentMemoryLoadableDocumentNames,
                },
                minItems: 1,
                maxItems: 3,
                description: "Agent-memory reference document filenames to load exactly.",
              },
            },
            required: ["documents"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: loadAgentMemoryFileSchema,
        execute: handlers.loadAgentMemoryFile,
      }),
    },
  };
}

export function memoryToolDefinitionForSnapshot(
  definition: AgentToolDefinition,
  memorySnapshot: AgentMemorySnapshot,
): AgentToolDefinition {
  const documentNames = memoryReferenceDocumentNames(memorySnapshot);
  const documentsProperty = definition.parameters.properties.documents;
  const documentsPropertyRecord = isRecord(documentsProperty) ? documentsProperty : {};
  const items = isRecord(documentsPropertyRecord.items) ? documentsPropertyRecord.items : {};
  return {
    ...definition,
    parameters: {
      ...definition.parameters,
      properties: {
        ...definition.parameters.properties,
        documents: {
          ...documentsPropertyRecord,
          items: {
            ...items,
            enum: documentNames,
          },
        },
      },
    },
  };
}

function memoryReferenceDocumentNames(memorySnapshot: AgentMemorySnapshot) {
  const names = memorySnapshot.referenceFiles.map((file) => file.fileName);
  return names.length > 0 ? names : agentMemoryReferenceDocumentNames;
}
