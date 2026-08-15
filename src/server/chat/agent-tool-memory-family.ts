import { z } from "zod";
import {
  type AgentMemoryReferenceFile,
  type AgentMemorySnapshot,
  loadAgentMemorySnapshot,
  requiredAgentMemoryManifest,
} from "@/server/chat/agent-memory";
import type { AgentToolResult } from "@/server/chat/agent-runtime";
import {
  type AgentToolDefinition,
  type AgentToolDependencies,
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

export function createMemoryToolFamily(
  handlers: MemoryToolHandlers = {
    loadAgentMemoryFile: (args, _request, dependencies) =>
      loadAgentMemoryFileToolResult(args, dependencies),
    searchAgentMemory: (args, _request, dependencies) =>
      searchAgentMemoryToolResult(args, dependencies),
  },
): AgentToolFamily {
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

export function searchAgentMemoryToolResult(
  args: SearchAgentMemoryArguments,
  dependencies: AgentToolDependencies,
): AgentToolResult {
  const snapshot = dependencies.memorySnapshot ?? loadAgentMemorySnapshot();
  const maxResults = args.max_results ?? 3;
  const selectedDocuments = new Set(args.documents ?? []);
  const referenceFiles =
    selectedDocuments.size > 0
      ? snapshot.referenceFiles.filter((file) => selectedDocuments.has(file.fileName))
      : snapshot.referenceFiles;
  const terms = tokenizeMemoryQuery(args.query);
  const results = referenceFiles
    .flatMap((file) => {
      const score = scoreMemoryFile(file.content, file.title, terms);
      if (score <= 0 && terms.length > 0) {
        return [];
      }
      return [
        {
          fileName: file.fileName,
          title: file.title,
          excerpt: findMemoryExcerpt(file.content, terms),
          score,
        },
      ];
    })
    .sort((left, right) => right.score - left.score || left.fileName.localeCompare(right.fileName))
    .slice(0, maxResults);

  return {
    name: "search_agent_memory",
    status: "success",
    text:
      results.length > 0
        ? renderAgentMemorySearchText(results)
        : "No Ask Siargao agent memory reference matched the query.",
    data: {
      status: "available",
      memoryVersionId: snapshot.versionId,
      results,
      caveat: "Agent memory retrieval is policy/reference context only and is not live evidence.",
    },
    sources: [],
  };
}

export function loadAgentMemoryFileToolResult(
  args: LoadAgentMemoryFileArguments,
  dependencies: AgentToolDependencies,
): AgentToolResult {
  const snapshot = dependencies.memorySnapshot ?? loadAgentMemorySnapshot();
  const selectedDocuments = new Set(args.documents);
  const files = snapshot.referenceFiles.filter((file) => selectedDocuments.has(file.fileName));
  const missingDocuments = args.documents.filter(
    (fileName) => !files.some((file) => file.fileName === fileName),
  );

  return {
    name: "load_agent_memory_file",
    status: missingDocuments.length > 0 ? "error" : "success",
    text:
      missingDocuments.length > 0
        ? `Ask Siargao agent memory file(s) were not available: ${missingDocuments.join(", ")}.`
        : renderLoadedAgentMemoryFilesText(files),
    ...(missingDocuments.length > 0 ? { errorCode: "not_found" } : {}),
    data: {
      status: missingDocuments.length > 0 ? "missing" : "available",
      memoryVersionId: snapshot.versionId,
      loadedMemoryFileNames: files.map((file) => file.fileName),
      files: files.map((file) => ({
        fileName: file.fileName,
        title: file.title,
        role: file.role,
        content: file.content,
      })),
      caveat: "Agent memory retrieval is policy/reference context only and is not live evidence.",
    },
    sources: [],
  };
}

function renderLoadedAgentMemoryFilesText(files: readonly AgentMemoryReferenceFile[]) {
  return [
    `Loaded Ask Siargao agent memory file(s): ${files.map((file) => file.fileName).join(", ")}.`,
    ...files.map((file) => `\n# ${file.fileName}\n${file.content.trim()}`),
    "Memory retrieval is policy/reference context only, not live evidence.",
  ].join("\n");
}

function tokenizeMemoryQuery(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .flatMap((term) => {
      const normalizedTerm = term.trim();
      return normalizedTerm.length > 2 ? [normalizedTerm] : [];
    });
}

function scoreMemoryFile(content: string, title: string, terms: readonly string[]) {
  const haystack = `${title}\n${content}`.toLowerCase();
  return terms.reduce((score, term) => score + countOccurrences(haystack, term), 0);
}

function countOccurrences(content: string, term: string) {
  let count = 0;
  let index = content.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }
  return count;
}

function findMemoryExcerpt(content: string, terms: readonly string[]) {
  const paragraphs = content.split(/\n{2,}/).flatMap((paragraph) => {
    const normalizedParagraph = normalizeMemoryText(paragraph.replace(/^#+\s*/gm, ""));
    return normalizedParagraph ? [normalizedParagraph] : [];
  });
  const term = terms.find((candidate) =>
    paragraphs.some((paragraph) => paragraph.toLowerCase().includes(candidate)),
  );
  const paragraph =
    paragraphs.find((candidate) => term && candidate.toLowerCase().includes(term)) ??
    paragraphs[0] ??
    "";
  return truncateMemoryExcerpt(paragraph);
}

function renderAgentMemorySearchText(
  results: readonly { fileName: string; title: string; excerpt: string }[],
) {
  return [
    "Ask Siargao agent memory reference matches:",
    ...results.map((result) => `- ${result.fileName}: ${result.excerpt}`),
    "Memory retrieval is policy/reference context only, not live evidence.",
  ].join("\n");
}

function normalizeMemoryText(content: string) {
  return content.replaceAll(/\s+/g, " ").trim();
}

function truncateMemoryExcerpt(excerpt: string) {
  if (excerpt.length <= 360) {
    return excerpt;
  }
  return `${excerpt.slice(0, 357).trimEnd()}...`;
}
