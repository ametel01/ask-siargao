import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadAgentMemorySnapshot, requiredAgentMemoryManifest } from "@/server/chat/agent-memory";

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
    expect(snapshot.instructionMarkdown).toContain("Ask Siargao Agent Skills");
    expect(snapshot.referenceFiles.map((file) => file.fileName)).toEqual([
      "ASK_SIARGAO_DATA_DICTIONARY.md",
      "ASK_SIARGAO_SOURCE_POLICY.md",
      "ASK_SIARGAO_LOCAL_ASSUMPTIONS.md",
    ]);
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

  test("instruction memory includes AI-written answer and live-tool requirements", () => {
    const snapshot = loadAgentMemorySnapshot();

    expect(snapshot.instructionMarkdown).toContain("Every final answer must be written by the AI");
    expect(snapshot.instructionMarkdown).toContain(
      "Use backend tools for live, local, provider-backed, or curated Ask Siargao facts",
    );
    expect(snapshot.instructionMarkdown).toContain("get_weather_forecast");
    expect(snapshot.instructionMarkdown).toContain("search_places");
  });

  test("reference memory includes data dictionary and source policy descriptors", () => {
    const snapshot = loadAgentMemorySnapshot();

    expect(snapshot.referenceFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: "ASK_SIARGAO_DATA_DICTIONARY.md",
          role: "reference",
          content: expect.stringContaining("Unrestricted database access is out of scope"),
        }),
        expect.objectContaining({
          fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
          role: "reference",
          content: expect.stringContaining(
            "Never create source labels from memory retrieval alone",
          ),
        }),
      ]),
    );
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
    case "ASK_SIARGAO_AGENT_SKILLS.md":
      return "Every final answer must be written by the AI.";
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
