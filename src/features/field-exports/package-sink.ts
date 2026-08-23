import { FieldSecurityError } from "@/features/field-security/errors";
import type { StagedArtifactSink } from "./package-format";

type OpfsStorageManager = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: readonly { accept: Record<string, readonly string[]>; description: string }[];
  }) => Promise<FileSystemFileHandle>;
};

type ShareNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

export class OpfsStagedArtifactSink implements StagedArtifactSink {
  private writable?: FileSystemWritableFileStream;
  private destinationWritable?: FileSystemWritableFileStream;
  private closed = false;

  private constructor(
    private readonly directory: FileSystemDirectoryHandle,
    private readonly handle: FileSystemFileHandle,
    private readonly temporaryName: string,
  ) {}

  static async create(): Promise<OpfsStagedArtifactSink> {
    const storage = navigator.storage as OpfsStorageManager;
    if (!storage.getDirectory) throw new FieldSecurityError("field_storage_unavailable");
    const directory = await storage.getDirectory();
    const temporaryName = `field-artifact-staged-${crypto.randomUUID()}.partial`;
    const handle = await directory.getFileHandle(temporaryName, { create: true });
    const sink = new OpfsStagedArtifactSink(directory, handle, temporaryName);
    sink.writable = await handle.createWritable({ keepExistingData: false });
    return sink;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.writable || this.closed) throw new FieldSecurityError("field_artifact_incomplete");
    await this.writable.write(new Uint8Array(bytes));
  }

  async close(): Promise<void> {
    if (!this.writable || this.closed) throw new FieldSecurityError("field_artifact_incomplete");
    await this.writable.close();
    this.closed = true;
  }

  async abort(): Promise<void> {
    await this.dispose();
  }

  async dispose(): Promise<void> {
    if (this.writable && !this.closed) await this.writable.abort().catch(() => undefined);
    this.writable = undefined;
    this.closed = false;
    await this.directory.removeEntry(this.temporaryName).catch(() => undefined);
  }

  async *reopen(): AsyncIterable<Uint8Array> {
    if (!this.closed) throw new FieldSecurityError("field_artifact_incomplete");
    const reader = (await this.handle.getFile()).stream().getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async publishVerified(input: {
    filename: string;
    kind: "field_batch" | "field_recovery";
  }): Promise<"published" | "physical_handoff_required"> {
    if (!this.closed) throw new FieldSecurityError("field_artifact_incomplete");
    const picker = window as SavePickerWindow;
    const sharing = navigator as ShareNavigator;
    if (!picker.showSaveFilePicker && !sharing.share) {
      await this.dispose();
      return "physical_handoff_required";
    }
    try {
      if (!picker.showSaveFilePicker) {
        const chunks: BlobPart[] = [];
        for await (const bytes of this.reopen()) {
          chunks.push(new Uint8Array(bytes) as unknown as BlobPart);
        }
        const file = new File(chunks, input.filename, { type: "application/octet-stream" });
        if (sharing.canShare && !sharing.canShare({ files: [file] })) {
          await this.dispose();
          return "physical_handoff_required";
        }
        await sharing.share?.({ files: [file], title: input.filename });
        await this.dispose();
        return "published";
      }
      const destination = await picker.showSaveFilePicker({
        suggestedName: input.filename,
        types: [
          {
            accept: {
              "application/octet-stream": [
                input.kind === "field_recovery" ? ".asfrecovery" : ".asfbatch",
              ],
            },
            description:
              input.kind === "field_recovery" ? "Field Recovery Export" : "Reviewed Field Batch",
          },
        ],
      });
      const writable = await destination.createWritable({ keepExistingData: false });
      this.destinationWritable = writable;
      for await (const bytes of this.reopen()) await writable.write(new Uint8Array(bytes));
      await writable.close();
      this.destinationWritable = undefined;
      await this.dispose();
      return "published";
    } catch (error) {
      await this.destinationWritable?.abort().catch(() => undefined);
      this.destinationWritable = undefined;
      await this.dispose();
      throw error;
    }
  }
}
