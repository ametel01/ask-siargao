import OpenAI, { toFile } from "openai";

import {
  type AgentMemoryReferenceFile,
  type AgentMemorySnapshot,
  loadAgentMemorySnapshot,
} from "@/server/chat/agent-memory";

export type AgentMemoryVectorStore = {
  id: string;
  name?: string;
  status?: string;
};

export type AgentMemoryVectorStoreFile = {
  id: string;
  status: "in_progress" | "completed" | "cancelled" | "failed";
  attributes?: Record<string, string | number | boolean> | null;
  last_error?: { code: string; message: string } | null;
};

export type AgentMemoryUploadedFile = {
  id: string;
};

export type AgentMemoryVectorStoreFileDeleted = {
  id: string;
  deleted: boolean;
};

export type AgentMemoryVectorStoreClient = {
  files: {
    create: (params: { file: File; purpose: "assistants" }) => Promise<AgentMemoryUploadedFile>;
  };
  vectorStores: {
    create: (params: {
      name: string;
      description: string;
      metadata: Record<string, string>;
    }) => Promise<AgentMemoryVectorStore>;
    retrieve: (vectorStoreId: string) => Promise<AgentMemoryVectorStore>;
    files: {
      list: (
        vectorStoreId: string,
      ) =>
        | AsyncIterable<AgentMemoryVectorStoreFile>
        | Iterable<AgentMemoryVectorStoreFile>
        | Promise<Iterable<AgentMemoryVectorStoreFile>>;
      createAndPoll: (
        vectorStoreId: string,
        params: {
          file_id: string;
          attributes: Record<string, string | number | boolean>;
        },
      ) => Promise<AgentMemoryVectorStoreFile>;
      delete: (
        fileId: string,
        params: { vector_store_id: string },
      ) => Promise<AgentMemoryVectorStoreFileDeleted>;
    };
  };
};

export type AgentMemoryVectorStoreSyncOptions = {
  client?: AgentMemoryVectorStoreClient;
  dryRun?: boolean;
  rootDir?: string;
  snapshot?: AgentMemorySnapshot;
  vectorStoreId?: string;
};

export type AgentMemoryVectorStoreSyncFileResult = {
  fileName: string;
  memoryId: string;
  checksum: string;
  action: "would_upload" | "uploaded" | "skipped_unchanged";
  vectorStoreFileId?: string;
  staleVectorStoreFileIdsDeleted?: readonly string[];
};

export type AgentMemoryVectorStoreSyncResult = {
  dryRun: boolean;
  memoryVersionId: string;
  vectorStoreId: string;
  vectorStoreCreated: boolean;
  referenceFileCount: number;
  files: AgentMemoryVectorStoreSyncFileResult[];
};

const vectorStoreName = "Ask Siargao Agent Memory";

export function createOpenAIAgentMemoryVectorStoreClient(
  apiKey = process.env.OPENAI_API_KEY,
): AgentMemoryVectorStoreClient {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to sync Ask Siargao agent memory.");
  }

  return new OpenAI({ apiKey, timeout: 30_000 }) as unknown as AgentMemoryVectorStoreClient;
}

export async function syncAgentMemoryVectorStore(
  options: AgentMemoryVectorStoreSyncOptions = {},
): Promise<AgentMemoryVectorStoreSyncResult> {
  const snapshot = options.snapshot ?? loadAgentMemorySnapshot({ rootDir: options.rootDir });
  const referenceFiles = snapshot.referenceFiles;

  if (options.dryRun) {
    return {
      dryRun: true,
      memoryVersionId: snapshot.versionId,
      vectorStoreId: options.vectorStoreId ?? "dry-run-vector-store",
      vectorStoreCreated: !options.vectorStoreId,
      referenceFileCount: referenceFiles.length,
      files: referenceFiles.map((file) => ({
        fileName: file.fileName,
        memoryId: file.id,
        checksum: file.checksum,
        action: "would_upload",
      })),
    };
  }

  const client = options.client ?? createOpenAIAgentMemoryVectorStoreClient();
  const vectorStore = await getOrCreateVectorStore({
    client,
    memoryVersionId: snapshot.versionId,
    vectorStoreId: options.vectorStoreId ?? process.env.OPENAI_AGENT_MEMORY_VECTOR_STORE_ID,
  });
  const existingFiles = await collectVectorStoreFiles(client, vectorStore.id);
  const files: AgentMemoryVectorStoreSyncFileResult[] = [];

  for (const file of referenceFiles) {
    const staleFiles = findStaleVectorStoreFiles(existingFiles, file);
    const existing = findUnchangedVectorStoreFile(existingFiles, file);
    if (existing) {
      const staleVectorStoreFileIdsDeleted = await deleteStaleVectorStoreFiles(
        client,
        vectorStore.id,
        staleFiles,
      );
      files.push({
        fileName: file.fileName,
        memoryId: file.id,
        checksum: file.checksum,
        action: "skipped_unchanged",
        vectorStoreFileId: existing.id,
        ...(staleVectorStoreFileIdsDeleted.length > 0 ? { staleVectorStoreFileIdsDeleted } : {}),
      });
      continue;
    }

    const uploaded = await client.files.create({
      file: await toFile(new Blob([file.content], { type: "text/markdown" }), file.fileName),
      purpose: "assistants",
    });
    const attached = await client.vectorStores.files.createAndPoll(vectorStore.id, {
      file_id: uploaded.id,
      attributes: vectorStoreFileAttributes(file, snapshot.versionId),
    });

    if (attached.status === "failed" || attached.last_error) {
      throw new Error(
        `Failed to process ${file.fileName} in vector store ${vectorStore.id}: ${
          attached.last_error?.message ?? attached.status
        }`,
      );
    }

    const staleVectorStoreFileIdsDeleted = await deleteStaleVectorStoreFiles(
      client,
      vectorStore.id,
      staleFiles,
    );

    files.push({
      fileName: file.fileName,
      memoryId: file.id,
      checksum: file.checksum,
      action: "uploaded",
      vectorStoreFileId: attached.id,
      ...(staleVectorStoreFileIdsDeleted.length > 0 ? { staleVectorStoreFileIdsDeleted } : {}),
    });
  }

  return {
    dryRun: false,
    memoryVersionId: snapshot.versionId,
    vectorStoreId: vectorStore.id,
    vectorStoreCreated: !options.vectorStoreId && !process.env.OPENAI_AGENT_MEMORY_VECTOR_STORE_ID,
    referenceFileCount: referenceFiles.length,
    files,
  };
}

export function formatAgentMemoryVectorStoreSyncResult(result: AgentMemoryVectorStoreSyncResult) {
  const lines = [
    `Agent memory version: ${result.memoryVersionId}`,
    `Vector store ID: ${result.vectorStoreId}`,
    `Mode: ${result.dryRun ? "dry-run" : "sync"}`,
    `Reference files: ${result.referenceFileCount}`,
  ];

  for (const file of result.files) {
    const staleDeleteSummary = file.staleVectorStoreFileIdsDeleted?.length
      ? `; deleted stale vector-store files: ${file.staleVectorStoreFileIdsDeleted.join(", ")}`
      : "";
    lines.push(`${file.action}: ${file.fileName} (${file.checksum})${staleDeleteSummary}`);
  }

  if (!result.dryRun) {
    lines.push(`Set OPENAI_AGENT_MEMORY_VECTOR_STORE_ID=${result.vectorStoreId}`);
  }

  return lines.join("\n");
}

async function getOrCreateVectorStore({
  client,
  memoryVersionId,
  vectorStoreId,
}: {
  client: AgentMemoryVectorStoreClient;
  memoryVersionId: string;
  vectorStoreId?: string;
}) {
  if (vectorStoreId) {
    return client.vectorStores.retrieve(vectorStoreId);
  }

  return client.vectorStores.create({
    name: vectorStoreName,
    description: "Ask Siargao persistent agent reference memory.",
    metadata: {
      product: "ask_siargao",
      purpose: "agent_memory",
      memory_version_id: memoryVersionId,
    },
  });
}

async function collectVectorStoreFiles(
  client: AgentMemoryVectorStoreClient,
  vectorStoreId: string,
) {
  const page = await client.vectorStores.files.list(vectorStoreId);
  const files: AgentMemoryVectorStoreFile[] = [];

  for await (const file of page) {
    files.push(file);
  }

  return files;
}

function findUnchangedVectorStoreFile(
  files: readonly AgentMemoryVectorStoreFile[],
  memoryFile: AgentMemoryReferenceFile,
) {
  return files.find(
    (file) =>
      file.attributes?.agent_memory_id === memoryFile.id &&
      file.attributes?.agent_memory_checksum === memoryFile.checksum,
  );
}

function findStaleVectorStoreFiles(
  files: readonly AgentMemoryVectorStoreFile[],
  memoryFile: AgentMemoryReferenceFile,
) {
  return files.filter(
    (file) =>
      file.attributes?.agent_memory_id === memoryFile.id &&
      file.attributes?.agent_memory_checksum !== memoryFile.checksum,
  );
}

async function deleteStaleVectorStoreFiles(
  client: AgentMemoryVectorStoreClient,
  vectorStoreId: string,
  files: readonly AgentMemoryVectorStoreFile[],
) {
  const deletedFileIds: string[] = [];

  for (const file of files) {
    const deleted = await client.vectorStores.files.delete(file.id, {
      vector_store_id: vectorStoreId,
    });

    if (!deleted.deleted) {
      throw new Error(
        `Failed to delete stale agent memory vector-store file ${file.id} from ${vectorStoreId}.`,
      );
    }

    deletedFileIds.push(file.id);
  }

  return deletedFileIds;
}

function vectorStoreFileAttributes(
  file: AgentMemoryReferenceFile,
  memoryVersionId: string,
): Record<string, string | number | boolean> {
  return {
    agent_memory_id: file.id,
    agent_memory_checksum: file.checksum,
    agent_memory_file_name: file.fileName,
    agent_memory_role: file.role,
    agent_memory_version_id: memoryVersionId,
    byte_length: file.byteLength,
  };
}
