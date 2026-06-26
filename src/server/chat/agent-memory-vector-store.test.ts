import { describe, expect, test } from "bun:test";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import {
  type AgentMemoryVectorStoreClient,
  type AgentMemoryVectorStoreFile,
  formatAgentMemoryVectorStoreSyncResult,
  syncAgentMemoryVectorStore,
} from "@/server/chat/agent-memory-vector-store";

describe("agent memory vector store sync", () => {
  test("returns dry-run output without a client or network calls", async () => {
    const snapshot = memorySnapshotFixture();
    const result = await syncAgentMemoryVectorStore({
      dryRun: true,
      snapshot,
    });

    expect(result).toMatchObject({
      dryRun: true,
      memoryVersionId: snapshot.versionId,
      vectorStoreId: "dry-run-vector-store",
      vectorStoreCreated: true,
      referenceFileCount: 2,
    });
    expect(result.files.map((file) => file.action)).toEqual(["would_upload", "would_upload"]);
  });

  test("creates a vector store when no vector store ID is provided", async () => {
    const client = fakeVectorStoreClient();
    const result = await syncAgentMemoryVectorStore({
      client,
      snapshot: memorySnapshotFixture(),
    });

    expect(client.calls.createVectorStore).toHaveLength(1);
    expect(client.calls.retrieveVectorStore).toEqual([]);
    expect(client.calls.uploadedFileNames).toEqual([
      "ASK_SIARGAO_DATA_DICTIONARY.md",
      "ASK_SIARGAO_SOURCE_POLICY.md",
    ]);
    expect(result.vectorStoreId).toBe("vs_created");
    expect(result.vectorStoreCreated).toBe(true);
    expect(result.files.map((file) => file.action)).toEqual(["uploaded", "uploaded"]);
  });

  test("reuses an existing vector store when an ID is provided", async () => {
    const client = fakeVectorStoreClient();
    const result = await syncAgentMemoryVectorStore({
      client,
      snapshot: memorySnapshotFixture(),
      vectorStoreId: "vs_existing",
    });

    expect(client.calls.createVectorStore).toEqual([]);
    expect(client.calls.retrieveVectorStore).toEqual(["vs_existing"]);
    expect(result.vectorStoreId).toBe("vs_existing");
    expect(result.vectorStoreCreated).toBe(false);
  });

  test("skips unchanged files using vector-store file attributes", async () => {
    const snapshot = memorySnapshotFixture();
    const client = fakeVectorStoreClient({
      existingFiles: [
        {
          id: "vsf_data_dictionary",
          status: "completed",
          attributes: {
            agent_memory_id: "ask_siargao_data_dictionary",
            agent_memory_checksum: "d".repeat(64),
          },
        },
      ],
    });
    const result = await syncAgentMemoryVectorStore({
      client,
      snapshot,
      vectorStoreId: "vs_existing",
    });

    expect(result.files.map((file) => file.action)).toEqual(["skipped_unchanged", "uploaded"]);
    expect(result.files[0]?.vectorStoreFileId).toBe("vsf_data_dictionary");
    expect(client.calls.uploadedFileNames).toEqual(["ASK_SIARGAO_SOURCE_POLICY.md"]);
  });

  test("deletes stale vector-store files for replaced memory documents", async () => {
    const client = fakeVectorStoreClient({
      existingFiles: [
        {
          id: "vsf_old_data_dictionary",
          status: "completed",
          attributes: {
            agent_memory_id: "ask_siargao_data_dictionary",
            agent_memory_checksum: "old-checksum",
          },
        },
        {
          id: "vsf_unrelated_memory",
          status: "completed",
          attributes: {
            agent_memory_id: "ask_siargao_other_memory",
            agent_memory_checksum: "old-checksum",
          },
        },
      ],
    });

    const result = await syncAgentMemoryVectorStore({
      client,
      snapshot: memorySnapshotFixture(),
      vectorStoreId: "vs_existing",
    });

    expect(result.files[0]).toMatchObject({
      action: "uploaded",
      staleVectorStoreFileIdsDeleted: ["vsf_old_data_dictionary"],
    });
    expect(client.calls.deletedFiles).toEqual([
      { fileId: "vsf_old_data_dictionary", vectorStoreId: "vs_existing" },
    ]);
    expect(client.calls.deletedFiles[0]?.fileId).not.toBe("vsf_unrelated_memory");
  });

  test("deletes stale duplicates even when the current checksum is already attached", async () => {
    const client = fakeVectorStoreClient({
      existingFiles: [
        {
          id: "vsf_current_data_dictionary",
          status: "completed",
          attributes: {
            agent_memory_id: "ask_siargao_data_dictionary",
            agent_memory_checksum: "d".repeat(64),
          },
        },
        {
          id: "vsf_stale_data_dictionary",
          status: "completed",
          attributes: {
            agent_memory_id: "ask_siargao_data_dictionary",
            agent_memory_checksum: "old-checksum",
          },
        },
      ],
    });

    const result = await syncAgentMemoryVectorStore({
      client,
      snapshot: memorySnapshotFixture(),
      vectorStoreId: "vs_existing",
    });

    expect(result.files[0]).toMatchObject({
      action: "skipped_unchanged",
      vectorStoreFileId: "vsf_current_data_dictionary",
      staleVectorStoreFileIdsDeleted: ["vsf_stale_data_dictionary"],
    });
    expect(client.calls.uploadedFileNames).toEqual(["ASK_SIARGAO_SOURCE_POLICY.md"]);
    expect(client.calls.deletedFiles).toEqual([
      { fileId: "vsf_stale_data_dictionary", vectorStoreId: "vs_existing" },
    ]);
  });

  test("propagates failed upload processing", async () => {
    const client = fakeVectorStoreClient({
      attachedStatus: "failed",
      lastError: { code: "invalid_file", message: "invalid Markdown file" },
    });

    await expect(
      syncAgentMemoryVectorStore({
        client,
        snapshot: memorySnapshotFixture(),
        vectorStoreId: "vs_existing",
      }),
    ).rejects.toThrow("invalid Markdown file");
  });

  test("formats output without secrets or raw memory bodies", async () => {
    const snapshot = memorySnapshotFixture({
      dataDictionaryContent: "RAW_MEMORY_BODY_SECRET",
    });
    const result = await syncAgentMemoryVectorStore({
      dryRun: true,
      snapshot,
      vectorStoreId: "vs_existing",
    });

    const output = formatAgentMemoryVectorStoreSyncResult(result);

    expect(output).toContain("Agent memory version");
    expect(output).toContain("ASK_SIARGAO_DATA_DICTIONARY.md");
    expect(output).not.toContain("RAW_MEMORY_BODY_SECRET");
    expect(output).not.toContain("OPENAI_API_KEY");
  });
});

function fakeVectorStoreClient({
  attachedStatus = "completed",
  existingFiles = [],
  lastError = null,
}: {
  attachedStatus?: AgentMemoryVectorStoreFile["status"];
  existingFiles?: AgentMemoryVectorStoreFile[];
  lastError?: AgentMemoryVectorStoreFile["last_error"];
} = {}) {
  const calls = {
    createVectorStore: [] as unknown[],
    retrieveVectorStore: [] as string[],
    uploadedFileNames: [] as string[],
    attachedAttributes: [] as Array<Record<string, string | number | boolean>>,
    deletedFiles: [] as Array<{ fileId: string; vectorStoreId: string }>,
  };
  const client: AgentMemoryVectorStoreClient & { calls: typeof calls } = {
    calls,
    files: {
      create: async ({ file }) => {
        calls.uploadedFileNames.push(file.name);
        return { id: `file_${calls.uploadedFileNames.length}` };
      },
    },
    vectorStores: {
      create: async (params) => {
        calls.createVectorStore.push(params);
        return { id: "vs_created", name: params.name, status: "completed" };
      },
      retrieve: async (vectorStoreId) => {
        calls.retrieveVectorStore.push(vectorStoreId);
        return { id: vectorStoreId, name: "Existing memory store", status: "completed" };
      },
      files: {
        list: () => existingFiles,
        createAndPoll: async (vectorStoreId, params) => {
          calls.attachedAttributes.push(params.attributes);
          return {
            id: `vsf_${params.file_id}`,
            vector_store_id: vectorStoreId,
            status: attachedStatus,
            attributes: params.attributes,
            ...(lastError ? { last_error: lastError } : { last_error: null }),
          };
        },
        delete: async (fileId, params) => {
          calls.deletedFiles.push({ fileId, vectorStoreId: params.vector_store_id });
          return { id: fileId, deleted: true };
        },
      },
    },
  };
  return client;
}

function memorySnapshotFixture({
  dataDictionaryContent = "Data dictionary content.",
}: {
  dataDictionaryContent?: string;
} = {}): AgentMemorySnapshot {
  const dataDictionary = {
    id: "ask_siargao_data_dictionary",
    title: "Ask Siargao Data Dictionary",
    fileName: "ASK_SIARGAO_DATA_DICTIONARY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_DATA_DICTIONARY.md",
    role: "reference" as const,
    checksum: "d".repeat(64),
    byteLength: dataDictionaryContent.length,
    content: dataDictionaryContent,
  };
  const sourcePolicy = {
    id: "ask_siargao_source_policy",
    title: "Ask Siargao Source Policy",
    fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
    role: "reference" as const,
    checksum: "s".repeat(64),
    byteLength: 22,
    content: "Source policy content.",
  };

  return {
    versionId: "agent-memory:syncfixture000000",
    files: [
      {
        id: "ask_siargao_agent_skills",
        title: "Ask Siargao Agent Skills",
        fileName: "ASK_SIARGAO_AGENT_SKILLS.md",
        relativePath: "docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md",
        role: "instruction",
        checksum: "a".repeat(64),
        byteLength: 20,
        content: "Instruction content.",
      },
      dataDictionary,
      sourcePolicy,
    ],
    instructionMarkdown: "Instruction content.",
    referenceFiles: [dataDictionary, sourcePolicy],
  };
}
