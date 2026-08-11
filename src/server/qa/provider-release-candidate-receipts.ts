import { appendFile, mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import type { ProviderReleaseCandidateLifecycleFiles } from "@/server/qa/provider-release-candidate";

export const providerReleaseCandidateDiskFiles: ProviderReleaseCandidateLifecycleFiles = {
  async append(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, content, { encoding: "utf8", flag: "a" });
  },
  async read(filePath) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  },
  async withLock(lockPath, work) {
    await mkdir(path.dirname(lockPath), { recursive: true });
    await acquireLock(lockPath);
    try {
      return await work();
    } finally {
      await rmdir(lockPath);
    }
  },
  async writeExclusive(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  },
};

async function acquireLock(lockPath: string) {
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      if (!isExistingFile(error) || Date.now() >= deadline) {
        throw error;
      }
      await setTimeout(25);
    }
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isExistingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
