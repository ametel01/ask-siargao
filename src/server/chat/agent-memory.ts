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

export type LoadAgentMemorySnapshotOptions = {
  rootDir?: string;
};

export const requiredAgentMemoryManifest = [
  {
    id: "ask_siargao_agent_skills",
    title: "Ask Siargao Agent Skills",
    fileName: "ASK_SIARGAO_AGENT_SKILLS.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md",
    role: "instruction",
  },
  {
    id: "ask_siargao_tool_use_policy",
    title: "Ask Siargao Tool Use Policy",
    fileName: "ASK_SIARGAO_TOOL_USE_POLICY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md",
    role: "instruction",
  },
  {
    id: "ask_siargao_data_dictionary",
    title: "Ask Siargao Data Dictionary",
    fileName: "ASK_SIARGAO_DATA_DICTIONARY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_DATA_DICTIONARY.md",
    role: "reference",
  },
  {
    id: "ask_siargao_source_policy",
    title: "Ask Siargao Source Policy",
    fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
    role: "reference",
  },
  {
    id: "ask_siargao_local_assumptions",
    title: "Ask Siargao Local Assumptions",
    fileName: "ASK_SIARGAO_LOCAL_ASSUMPTIONS.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_LOCAL_ASSUMPTIONS.md",
    role: "reference",
  },
] as const satisfies readonly AgentMemoryManifestEntry[];

export function loadAgentMemorySnapshot(
  options: LoadAgentMemorySnapshotOptions = {},
): AgentMemorySnapshot {
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
    files,
    instructionMarkdown: renderInstructionMarkdown(files.filter(isInstructionFile)),
    referenceFiles: files.filter(isReferenceFile),
  };
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
