import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export type AgentMemoryRole = "instruction" | "reference";

export type AgentMemoryManifestEntry = {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  role: AgentMemoryRole;
  description?: string;
  triggerTerms?: readonly string[];
};

export type AgentMemoryDocumentMetadata = AgentMemoryManifestEntry & {
  description: string;
  triggerTerms: readonly string[];
};

export type AgentMemoryFile = AgentMemoryManifestEntry & {
  content: string;
  checksum: string;
  byteLength: number;
};

export type AgentMemoryReferenceFile = AgentMemoryFile & {
  role: "reference";
};

export type AgentMemoryInstructionFile = AgentMemoryFile & {
  role: "instruction";
};

export type AgentMemorySnapshot = {
  versionId: string;
  files: readonly AgentMemoryFile[];
  instructionMarkdown: string;
  referenceFiles: readonly AgentMemoryReferenceFile[];
};

export type AgentMemoryLoadOutcome = AgentMemorySnapshot & {
  documents: readonly AgentMemoryDocumentMetadata[];
  errors: readonly AgentMemoryLoadError[];
};

export type AgentMemoryLoadError = {
  relativePath: string;
  code: "missing";
  message: string;
};

export type LoadAgentMemorySnapshotOptions = {
  rootDir?: string;
};

export type RenderAvailableAgentMemoryOptions = {
  maxCharacters?: number;
};

export const requiredAgentMemoryManifest = [
  {
    id: "ask_siargao_memory_index",
    title: "Ask Siargao Agent Memory Index",
    fileName: "INDEX.md",
    relativePath: "docs/agent-memory/INDEX.md",
    role: "instruction",
    description:
      "Default memory index that routes the model to the smallest relevant reference files.",
    triggerTerms: ["memory routing", "which file to load", "agent memory index"],
  },
  {
    id: "ask_siargao_surf",
    title: "Siargao Surf Spots",
    fileName: "SURF.md",
    relativePath: "docs/agent-memory/SURF.md",
    role: "reference",
    description:
      "Surf spot recommendations, skill matching, surf zones, and boundaries between surf breaks and normal beaches.",
    triggerTerms: ["surf", "waves", "Cloud 9", "Pacifico", "beginner surf", "near me surf"],
  },
  {
    id: "ask_siargao_local_guide_beaches",
    title: "Siargao Tourist-Worthy Beaches",
    fileName: "LOCAL_GUIDE_BEACHES.md",
    relativePath: "docs/agent-memory/LOCAL_GUIDE_BEACHES.md",
    role: "reference",
    description:
      "Beach-day recommendations, swimming and sand tradeoffs, quiet/family beaches, access patterns, and beach fallback boundaries.",
    triggerTerms: ["beach", "swimming", "sand", "family beach", "quiet beach", "island beach"],
  },
  {
    id: "ask_siargao_nightlife",
    title: "Siargao Nightlife",
    fileName: "NIGHTLIFE.md",
    relativePath: "docs/agent-memory/NIGHTLIFE.md",
    role: "reference",
    description:
      "General Luna nightlife routes, party rhythm, event-source priority, venue fit, and boundaries between stable nightlife memory and live event evidence.",
    triggerTerms: [
      "party",
      "nightlife",
      "bar hopping",
      "drinks",
      "DJ",
      "live music",
      "foam party",
      "pub quiz",
      "trivia",
      "late night",
      "tonight",
    ],
  },
  {
    id: "ask_siargao_agent_skills",
    title: "Ask Siargao Agent Skills",
    fileName: "ASK_SIARGAO_AGENT_SKILLS.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md",
    role: "reference",
    description:
      "Answer style, scope, final-answer expectations, surf-timing shape, and practical condition-answer phrasing.",
    triggerTerms: ["answer style", "scope", "final answer", "condition phrasing", "surf timing"],
  },
  {
    id: "ask_siargao_answer_patterns",
    title: "Ask Siargao Answer Patterns",
    fileName: "ASK_SIARGAO_ANSWER_PATTERNS.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md",
    role: "reference",
    description:
      "Request-type answer patterns for direct-answer-first local judgments, constraint preservation, practical fallbacks, and bad answer smells.",
    triggerTerms: [
      "answer patterns",
      "direct answer",
      "request type",
      "local judgment",
      "bad answer smells",
      "itinerary review",
      "transport logistics",
      "safety service",
    ],
  },
  {
    id: "ask_siargao_tool_use_policy",
    title: "Ask Siargao Tool Use Policy",
    fileName: "ASK_SIARGAO_TOOL_USE_POLICY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md",
    role: "reference",
    description:
      "Rules for when weather, tide, marine, condition, Google Places, itinerary, database, source, or memory tools are required.",
    triggerTerms: ["tool use", "weather tool", "places tool", "condition tool", "itinerary tool"],
  },
  {
    id: "ask_siargao_data_dictionary",
    title: "Ask Siargao Data Dictionary",
    fileName: "ASK_SIARGAO_DATA_DICTIONARY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_DATA_DICTIONARY.md",
    role: "reference",
    description:
      "Safe chat runtime data surfaces, database and local-fact boundaries, query contracts, and disallowed fields.",
    triggerTerms: ["database", "local facts", "data contract", "safe fields", "query boundary"],
  },
  {
    id: "ask_siargao_source_policy",
    title: "Ask Siargao Source Policy",
    fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
    role: "reference",
    description:
      "Checked/not-checked wording, source-label meanings, confidence boundaries, and memory-versus-live evidence rules.",
    triggerTerms: ["source label", "checked", "not checked", "confidence", "live evidence"],
  },
  {
    id: "ask_siargao_local_assumptions",
    title: "Ask Siargao Local Assumptions",
    fileName: "ASK_SIARGAO_LOCAL_ASSUMPTIONS.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_LOCAL_ASSUMPTIONS.md",
    role: "reference",
    description:
      "Stable planning assumptions for traveler bases, ride-time caveats, weather sensitivity, ocean safety, and General Luna or Cloud 9 defaults.",
    triggerTerms: ["assumptions", "ride time", "General Luna", "Cloud 9", "traveler base"],
  },
] as const satisfies readonly AgentMemoryManifestEntry[];

export function loadAgentMemorySnapshot(
  options: LoadAgentMemorySnapshotOptions = {},
): AgentMemoryLoadOutcome {
  const rootDir = options.rootDir ?? process.cwd();
  const memoryDir = path.join(rootDir, "docs", "agent-memory");
  const missingFiles: string[] = [];
  const files: AgentMemoryFile[] = [];

  for (const entry of requiredAgentMemoryManifest) {
    const absolutePath = path.join(memoryDir, entry.fileName);
    try {
      const content = readFileSync(absolutePath, "utf8");
      files.push({
        ...entry,
        content,
        checksum: checksumContent(content),
        byteLength: Buffer.byteLength(content, "utf8"),
      });
    } catch (error) {
      if (isMissingFileError(error)) {
        missingFiles.push(entry.relativePath);
        continue;
      }
      throw error;
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(
      `Missing required Ask Siargao agent memory file(s): ${missingFiles.join(", ")}`,
    );
  }

  return {
    versionId: buildVersionId(files),
    documents: files.map(documentMetadataFromFile),
    files,
    instructionMarkdown: renderInstructionMarkdown(files.filter(isInstructionFile)),
    referenceFiles: files.filter(isReferenceFile),
    errors: [],
  };
}

export function renderAvailableAgentMemory(
  outcome: AgentMemorySnapshot | AgentMemoryLoadOutcome,
  options: RenderAvailableAgentMemoryOptions = {},
): string {
  const maxCharacters = options.maxCharacters ?? 4_000;
  const documents = memoryDocumentsFromSnapshot(outcome);
  const referenceDocuments = documents.filter((document) => document.role === "reference");
  const headerLines = [
    "# Available Ask Siargao Agent Memory",
    "",
    "Memory files are policy and local-reference context, not live evidence.",
    "INDEX.md is already loaded. Use it to choose the smallest relevant set.",
    "Load exact files with load_agent_memory_file when full guidance is needed.",
    "Memory files do not persist across turns unless reloaded or already present in context.",
    "",
    "Reference files:",
  ];
  const header = headerLines.join("\n");
  const fullLines = referenceDocuments.map((document) => renderMemoryMetadataLine(document));
  const fullBlock = [header, ...fullLines].join("\n");
  if (fullBlock.length <= maxCharacters) {
    return fullBlock;
  }

  const minimalLines = referenceDocuments.map((document) => renderMemoryMetadataLine(document, 0));
  const minimalBlock = [header, ...minimalLines].join("\n");
  if (minimalBlock.length >= maxCharacters) {
    return minimalBlock;
  }

  const availableDescriptionCharacters = Math.max(
    0,
    maxCharacters - minimalBlock.length - referenceDocuments.length,
  );
  const descriptionCharactersPerFile = Math.floor(
    availableDescriptionCharacters / Math.max(1, referenceDocuments.length),
  );
  return [
    header,
    ...referenceDocuments.map((document) =>
      renderMemoryMetadataLine(document, descriptionCharactersPerFile),
    ),
  ].join("\n");
}

function renderMemoryMetadataLine(
  document: AgentMemoryDocumentMetadata,
  descriptionBudget = document.description.length,
) {
  const description =
    descriptionBudget > 0 ? truncateText(document.description, descriptionBudget) : "";
  const triggerTerms = document.triggerTerms.length
    ? ` Triggers: ${document.triggerTerms.join(", ")}.`
    : "";
  return `- ${document.fileName} — ${document.title} (${document.role}): ${description}${triggerTerms}`;
}

function truncateText(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) {
    return value;
  }
  if (maxCharacters <= 1) {
    return "";
  }
  return `${value.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

function documentMetadataFromFile(file: AgentMemoryFile): AgentMemoryDocumentMetadata {
  return {
    id: file.id,
    title: file.title,
    fileName: file.fileName,
    relativePath: file.relativePath,
    role: file.role,
    description: file.description ?? "",
    triggerTerms: file.triggerTerms ?? [],
  };
}

function memoryDocumentsFromSnapshot(
  outcome: AgentMemorySnapshot | AgentMemoryLoadOutcome,
): readonly AgentMemoryDocumentMetadata[] {
  if ("documents" in outcome) {
    return outcome.documents;
  }
  return outcome.files.map(documentMetadataFromFile);
}

function renderInstructionMarkdown(files: readonly AgentMemoryInstructionFile[]) {
  return files.map((file) => file.content.trim()).join("\n\n");
}

function buildVersionId(files: readonly AgentMemoryFile[]) {
  const versionSeed = files
    .map((file) => `${file.id}:${file.role}:${file.relativePath}:${file.checksum}`)
    .join("\n");
  return `agent-memory:${checksumContent(versionSeed).slice(0, 24)}`;
}

function checksumContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function isInstructionFile(file: AgentMemoryFile): file is AgentMemoryInstructionFile {
  return file.role === "instruction";
}

function isReferenceFile(file: AgentMemoryFile): file is AgentMemoryReferenceFile {
  return file.role === "reference";
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
