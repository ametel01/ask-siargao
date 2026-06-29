import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadAgentMemorySnapshot,
  renderAvailableAgentMemory,
  requiredAgentMemoryManifest,
} from "@/server/chat/agent-memory";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("agent memory loader", () => {
  test("loads all required files from the repository root", () => {
    const snapshot = loadAgentMemorySnapshot();

    expect(snapshot.files.map((file) => file.fileName)).toEqual(
      requiredAgentMemoryManifest.map((entry) => entry.fileName),
    );
    expect(snapshot.files.every((file) => file.checksum.length === 64)).toBe(true);
    expect(snapshot.versionId).toMatch(/^agent-memory:[a-f0-9]{24}$/);
    expect(snapshot.instructionMarkdown).toContain("Ask Siargao Agent Memory Index");
    expect(snapshot.instructionMarkdown).toContain("SURF.md");
    expect(snapshot.referenceFiles.map((file) => file.fileName)).toEqual([
      "SURF.md",
      "LOCAL_GUIDE_BEACHES.md",
      "ASK_SIARGAO_AGENT_SKILLS.md",
      "ASK_SIARGAO_ANSWER_PATTERNS.md",
      "ASK_SIARGAO_TOOL_USE_POLICY.md",
      "ASK_SIARGAO_DATA_DICTIONARY.md",
      "ASK_SIARGAO_SOURCE_POLICY.md",
      "ASK_SIARGAO_LOCAL_ASSUMPTIONS.md",
    ]);
    expect(snapshot.documents.map((document) => document.fileName)).toEqual(
      requiredAgentMemoryManifest.map((entry) => entry.fileName),
    );
    expect(snapshot.documents.every((document) => document.description.length > 0)).toBe(true);
    expect(snapshot.documents.every((document) => document.triggerTerms.length > 0)).toBe(true);
    expect(snapshot.errors).toEqual([]);
  });

  test("fails with a clear error when required memory files are missing", () => {
    const root = createMemoryRoot({
      skipFileName: "ASK_SIARGAO_SOURCE_POLICY.md",
    });

    expect(() => loadAgentMemorySnapshot({ rootDir: root })).toThrow(
      "Missing required Ask Siargao agent memory file(s): docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
    );
  });

  test("changes file checksums and aggregate version IDs when content changes", () => {
    const root = createMemoryRoot();
    const first = loadAgentMemorySnapshot({ rootDir: root });
    const target = path.join(root, "docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md");

    writeFileSync(
      target,
      "# Ask Siargao Tool Use Policy\n\nLive local facts still require tools.\nUpdated policy.\n",
    );

    const second = loadAgentMemorySnapshot({ rootDir: root });
    const firstPolicy = first.files.find(
      (file) => file.fileName === "ASK_SIARGAO_TOOL_USE_POLICY.md",
    );
    const secondPolicy = second.files.find(
      (file) => file.fileName === "ASK_SIARGAO_TOOL_USE_POLICY.md",
    );

    expect(firstPolicy?.checksum).not.toBe(secondPolicy?.checksum);
    expect(first.versionId).not.toBe(second.versionId);
  });

  test("instruction memory only includes the dynamic memory index", () => {
    const snapshot = loadAgentMemorySnapshot();

    expect(snapshot.instructionMarkdown).toContain("This is the only domain-memory file");
    expect(snapshot.instructionMarkdown).toContain(
      "load the relevant file before the final answer",
    );
    expect(snapshot.instructionMarkdown).toContain("SURF.md");
    expect(snapshot.instructionMarkdown).toContain("ASK_SIARGAO_TOOL_USE_POLICY.md");
    expect(snapshot.instructionMarkdown).toContain("ASK_SIARGAO_ANSWER_PATTERNS.md");
    expect(snapshot.instructionMarkdown).not.toContain(
      "Every final answer must be written by the AI",
    );
    expect(snapshot.instructionMarkdown).not.toContain("Bad Answer Smells");
    expect(snapshot.instructionMarkdown).not.toContain(
      "Generic tourist lists that do not answer the exact request",
    );
    expect(snapshot.instructionMarkdown).not.toContain("get_condition_judgment");
    expect(snapshot.instructionMarkdown).not.toContain("checksum:");
    expect(snapshot.instructionMarkdown).not.toMatch(/[a-f0-9]{64}/);
  });

  test("reference memory includes data dictionary and source policy descriptors", () => {
    const snapshot = loadAgentMemorySnapshot();

    expect(snapshot.referenceFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: "SURF.md",
          role: "reference",
          content: expect.stringContaining("Hard Boundary: Surf Spots vs Beach Fallbacks"),
        }),
        expect.objectContaining({
          fileName: "LOCAL_GUIDE_BEACHES.md",
          role: "reference",
          content: expect.stringContaining("Do not use this file alone to answer surf-spot"),
        }),
        expect.objectContaining({
          fileName: "ASK_SIARGAO_DATA_DICTIONARY.md",
          role: "reference",
          content: expect.stringContaining("Safe local data tools must not expose private"),
        }),
        expect.objectContaining({
          fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
          role: "reference",
          content: expect.stringContaining("Memory retrieval is policy/reference context"),
        }),
        expect.objectContaining({
          fileName: "ASK_SIARGAO_ANSWER_PATTERNS.md",
          role: "reference",
          content: expect.stringContaining("Bad Answer Smells"),
        }),
      ]),
    );
  });

  test("registers answer patterns as required reference memory with useful metadata", () => {
    const snapshot = loadAgentMemorySnapshot();

    const manifestEntry = requiredAgentMemoryManifest.find(
      (entry) => entry.fileName === "ASK_SIARGAO_ANSWER_PATTERNS.md",
    );
    const document = snapshot.documents.find(
      (entry) => entry.fileName === "ASK_SIARGAO_ANSWER_PATTERNS.md",
    );
    const referenceFile = snapshot.referenceFiles.find(
      (file) => file.fileName === "ASK_SIARGAO_ANSWER_PATTERNS.md",
    );
    const rendered = renderAvailableAgentMemory(snapshot);

    expect(manifestEntry).toEqual(
      expect.objectContaining({
        role: "reference",
        relativePath: "docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md",
      }),
    );
    expect(document?.description).toContain("Request-type answer patterns");
    expect(document?.triggerTerms).toEqual(
      expect.arrayContaining(["direct answer", "bad answer smells", "transport logistics"]),
    );
    expect(referenceFile?.content).toContain("Direct Answer First");
    expect(rendered).toContain("ASK_SIARGAO_ANSWER_PATTERNS.md");
    expect(rendered).toContain("Request-type answer patterns");
    expect(rendered).toContain("direct answer");
    expect(rendered).not.toContain("Generic tourist lists that do not answer the exact request");
  });

  test("renders compact available memory metadata without full reference bodies", () => {
    const snapshot = loadAgentMemorySnapshot();
    const rendered = renderAvailableAgentMemory(snapshot);

    for (const file of snapshot.referenceFiles) {
      expect(rendered).toContain(file.fileName);
      expect(rendered).toContain(file.title);
    }
    expect(rendered).toContain("policy and local-reference context, not live evidence");
    expect(rendered).toContain("load_agent_memory_file");
    expect(rendered).toContain("Memory files do not persist across turns");
    expect(rendered).not.toContain("Hard Boundary: Surf Spots vs Beach Fallbacks");
    expect(rendered).not.toContain("Safe local data tools must not expose private");
    expect(rendered).not.toContain("checksum");
    expect(rendered).not.toMatch(/[a-f0-9]{64}/);
  });

  test("keeps rendered memory metadata inside the configured budget when practical", () => {
    const snapshot = loadAgentMemorySnapshot();
    const rendered = renderAvailableAgentMemory(snapshot, { maxCharacters: 2_000 });

    expect(rendered.length).toBeLessThanOrEqual(2_000);
    for (const file of snapshot.referenceFiles) {
      expect(rendered).toContain(file.fileName);
    }
    expect(rendered).not.toContain("Hard Boundary: Surf Spots vs Beach Fallbacks");
  });
});

function createMemoryRoot(options: { skipFileName?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ask-siargao-memory-"));
  temporaryRoots.push(root);
  const memoryDir = path.join(root, "docs/agent-memory");
  mkdirSync(memoryDir, { recursive: true });

  for (const entry of requiredAgentMemoryManifest) {
    if (entry.fileName === options.skipFileName) {
      continue;
    }
    writeFileSync(
      path.join(root, entry.relativePath),
      [`# ${entry.title}`, "", fixtureContentFor(entry.fileName), ""].join("\n"),
    );
  }

  return root;
}

function fixtureContentFor(fileName: string) {
  switch (fileName) {
    case "INDEX.md":
      return "Load the smallest relevant memory files. SURF.md covers surf spots.";
    case "SURF.md":
      return "Surf spots are separate from beach fallbacks.";
    case "LOCAL_GUIDE_BEACHES.md":
      return "Beach guide fallbacks are not surf spot recommendations.";
    case "ASK_SIARGAO_AGENT_SKILLS.md":
      return "Every final answer must be written by the AI.";
    case "ASK_SIARGAO_ANSWER_PATTERNS.md":
      return "Answer the exact traveler request first and avoid generic tourist lists.";
    case "ASK_SIARGAO_TOOL_USE_POLICY.md":
      return "Live local facts still require tools.";
    case "ASK_SIARGAO_DATA_DICTIONARY.md":
      return "Unrestricted database access is out of scope.";
    case "ASK_SIARGAO_SOURCE_POLICY.md":
      return "Never create source labels from memory retrieval alone.";
    case "ASK_SIARGAO_LOCAL_ASSUMPTIONS.md":
      return "Ride-time estimates are approximate.";
    default:
      return "Required memory.";
  }
}
