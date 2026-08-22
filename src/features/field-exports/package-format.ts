import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  canonicalStringify,
  compareCanonicalStrings,
} from "@/features/field-protocol/canonical-json";
import {
  fieldTextDecoder,
  fieldTextEncoder,
  randomFieldBytes,
  zeroize,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import {
  type ArtifactFileManifest,
  type ArtifactKind,
  type ArtifactPreamble,
  type ArtifactRootManifest,
  artifactPreambleSchema,
  artifactRootManifestSchema,
  FIELD_BATCH_CONTAINER_VERSION,
  FIELD_RECOVERY_CONTAINER_VERSION,
} from "./artifact-schemas";

export const FIELD_RECOVERY_MAGIC = fieldTextEncoder.encode("ASFR\0\u0001\r\n");
export const FIELD_BATCH_MAGIC = fieldTextEncoder.encode("ASFB\0\u0001\r\n");
export const DEFAULT_ARTIFACT_CHUNK_SIZE = 256 * 1024;
const payloadFrame = 1;
const rootManifestFrame = 2;
const maxPreambleBytes = 64 * 1024;
const maxFrameBytes = 4 * 1024 * 1024 + 64;
const maxCanonicalLineBytes = 4 * 1024 * 1024;

export type ArtifactRecordFile = Readonly<{
  path: string;
  recordType: string;
  records: AsyncIterable<unknown> | Iterable<unknown>;
}>;

export interface StagedArtifactSink {
  abort(reason: unknown): Promise<void>;
  close(): Promise<void>;
  reopen(): AsyncIterable<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
}

export type PackagedArtifact = Readonly<{
  artifactKind: ArtifactKind;
  ciphertextSha256: string;
  encryptedBytes: number;
  files: readonly ArtifactFileManifest[];
  rootManifest: ArtifactRootManifest;
}>;

export async function packageCanonicalArtifact(input: {
  authorityExclusions: Readonly<ArtifactRootManifest["authorityExclusions"]>;
  contentKey: Uint8Array;
  files: readonly ArtifactRecordFile[];
  preamble: ArtifactPreamble;
  referentialClosureSha256?: string;
  sink: StagedArtifactSink;
}): Promise<PackagedArtifact> {
  if (input.contentKey.length !== 32 || input.files.length === 0) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  const preamble = artifactPreambleSchema.parse(input.preamble);
  assertPreambleDispatch(preamble);
  assertFileOrder(input.files);
  const artifactHash = sha256.create();
  const payloadHash = sha256.create();
  const fileManifests: ArtifactFileManifest[] = [];
  let encryptedBytes = 0;
  let payloadCiphertextBytes = 0;
  let plaintextBytes = 0;
  let chunkCount = 0;
  const write = async (bytes: Uint8Array) => {
    await input.sink.write(bytes);
    artifactHash.update(bytes);
    encryptedBytes += bytes.length;
  };
  try {
    const magic = magicForKind(preamble.artifactKind);
    const preambleBytes = fieldTextEncoder.encode(canonicalStringify(preamble));
    await write(concatBytes(magic, uint32(preambleBytes.length), preambleBytes));
    const source = canonicalFileSource(input.files, fileManifests);
    for await (const plaintext of fixedSizeChunks(source, preamble.chunkSize)) {
      const nonce = randomFieldBytes(24);
      const aad = payloadAad(preamble, chunkCount);
      const ciphertext = xchacha20poly1305(input.contentKey, nonce, aad).encrypt(plaintext);
      const frame = concatBytes(
        Uint8Array.of(payloadFrame),
        uint32(chunkCount),
        nonce,
        uint32(ciphertext.length),
        ciphertext,
      );
      await write(frame);
      payloadHash.update(ciphertext);
      payloadCiphertextBytes += ciphertext.length;
      plaintextBytes += plaintext.length;
      chunkCount += 1;
      zeroize(plaintext);
    }
    if (chunkCount === 0) throw new FieldSecurityError("field_artifact_invalid");
    const rootManifest = artifactRootManifestSchema.parse({
      schemaVersion: "field-artifact-root-manifest.v1",
      artifactId: preamble.artifactId,
      artifactKind: preamble.artifactKind,
      transferId: preamble.transferId,
      payloadChunkCount: chunkCount,
      plaintextBytes,
      payloadCiphertextBytes,
      payloadCiphertextSha256: hex(payloadHash.digest()),
      files: fileManifests,
      ...(input.referentialClosureSha256
        ? { referentialClosureSha256: input.referentialClosureSha256 }
        : {}),
      authorityExclusions: [...input.authorityExclusions],
    });
    const rootNonce = randomFieldBytes(24);
    const rootCiphertext = xchacha20poly1305(
      input.contentKey,
      rootNonce,
      rootAad(preamble),
    ).encrypt(fieldTextEncoder.encode(canonicalStringify(rootManifest)));
    await write(
      concatBytes(
        Uint8Array.of(rootManifestFrame),
        rootNonce,
        uint32(rootCiphertext.length),
        rootCiphertext,
      ),
    );
    await input.sink.close();
    const firstHash = hex(artifactHash.digest());
    const reopened = sha256.create();
    let reopenedBytes = 0;
    for await (const bytes of input.sink.reopen()) {
      reopened.update(bytes);
      reopenedBytes += bytes.length;
    }
    if (reopenedBytes !== encryptedBytes || hex(reopened.digest()) !== firstHash) {
      throw new FieldSecurityError("field_artifact_incomplete");
    }
    return {
      artifactKind: preamble.artifactKind,
      ciphertextSha256: firstHash,
      encryptedBytes,
      files: fileManifests,
      rootManifest,
    };
  } catch (error) {
    await input.sink.abort(error).catch(() => undefined);
    if (error instanceof FieldSecurityError) throw error;
    throw new FieldSecurityError("field_artifact_incomplete");
  }
}

export async function openCanonicalArtifact(input: {
  expectedCiphertextSha256: string;
  expectedKind: ArtifactKind;
  openContentKey: (preamble: ArtifactPreamble) => Promise<Uint8Array>;
  onRecord: (record: { path: string; recordType: string; value: unknown }) => Promise<void> | void;
  source: AsyncIterable<Uint8Array>;
}): Promise<{ preamble: ArtifactPreamble; rootManifest: ArtifactRootManifest }> {
  const reader = new BoundedByteReader(input.source);
  const artifactHash = sha256.create();
  reader.observe((bytes) => artifactHash.update(bytes));
  const expectedMagic = magicForKind(input.expectedKind);
  if (!equalBytes(await reader.readExact(expectedMagic.length), expectedMagic)) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  const preambleLength = readUint32(await reader.readExact(4));
  if (preambleLength < 1 || preambleLength > maxPreambleBytes) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  const preamble = artifactPreambleSchema.parse(
    JSON.parse(fieldTextDecoder.decode(await reader.readExact(preambleLength))),
  );
  if (preamble.artifactKind !== input.expectedKind) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  assertPreambleDispatch(preamble);
  const contentKey = await input.openContentKey(preamble);
  if (contentKey.length !== 32) throw new FieldSecurityError("field_key_unavailable");
  const payloadHash = sha256.create();
  const lineValidator = new CanonicalLineValidator(input.onRecord);
  let expectedIndex = 0;
  let plaintextBytes = 0;
  let payloadCiphertextBytes = 0;
  let rootManifest: ArtifactRootManifest | undefined;
  try {
    while (!rootManifest) {
      const frameType = (await reader.readExact(1))[0];
      if (frameType === payloadFrame) {
        const index = readUint32(await reader.readExact(4));
        if (index !== expectedIndex) throw new FieldSecurityError("field_artifact_invalid");
        const nonce = await reader.readExact(24);
        const ciphertextLength = readUint32(await reader.readExact(4));
        if (ciphertextLength < 17 || ciphertextLength > maxFrameBytes) {
          throw new FieldSecurityError("field_artifact_invalid");
        }
        const ciphertext = await reader.readExact(ciphertextLength);
        const plaintext = xchacha20poly1305(contentKey, nonce, payloadAad(preamble, index)).decrypt(
          ciphertext,
        );
        payloadHash.update(ciphertext);
        payloadCiphertextBytes += ciphertext.length;
        plaintextBytes += plaintext.length;
        await lineValidator.push(plaintext);
        zeroize(plaintext);
        expectedIndex += 1;
        continue;
      }
      if (frameType !== rootManifestFrame) {
        throw new FieldSecurityError("field_artifact_invalid");
      }
      const nonce = await reader.readExact(24);
      const ciphertextLength = readUint32(await reader.readExact(4));
      if (ciphertextLength < 17 || ciphertextLength > maxFrameBytes) {
        throw new FieldSecurityError("field_artifact_invalid");
      }
      const ciphertext = await reader.readExact(ciphertextLength);
      const plaintext = xchacha20poly1305(contentKey, nonce, rootAad(preamble)).decrypt(ciphertext);
      try {
        rootManifest = artifactRootManifestSchema.parse(
          JSON.parse(fieldTextDecoder.decode(plaintext)),
        );
      } finally {
        zeroize(plaintext);
      }
    }
    await lineValidator.close();
    if (!(await reader.isDone())) throw new FieldSecurityError("field_artifact_invalid");
    if (
      rootManifest.artifactId !== preamble.artifactId ||
      rootManifest.artifactKind !== preamble.artifactKind ||
      rootManifest.transferId !== preamble.transferId ||
      rootManifest.payloadChunkCount !== expectedIndex ||
      rootManifest.plaintextBytes !== plaintextBytes ||
      rootManifest.payloadCiphertextBytes !== payloadCiphertextBytes ||
      rootManifest.payloadCiphertextSha256 !== hex(payloadHash.digest()) ||
      canonicalStringify(rootManifest.files) !== canonicalStringify(lineValidator.manifests()) ||
      hex(artifactHash.digest()) !== input.expectedCiphertextSha256
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    return { preamble, rootManifest };
  } catch (error) {
    if (error instanceof FieldSecurityError) throw error;
    throw new FieldSecurityError("field_artifact_invalid");
  } finally {
    zeroize(contentKey);
  }
}

export class MemoryStagedArtifactSink implements StagedArtifactSink {
  private chunks: Uint8Array[] = [];
  private closed = false;
  private aborted = false;

  async write(bytes: Uint8Array): Promise<void> {
    if (this.closed || this.aborted) throw new Error("sink closed");
    this.chunks.push(bytes.slice());
  }

  async close(): Promise<void> {
    if (this.aborted) throw new Error("sink aborted");
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.chunks = [];
  }

  async *reopen(): AsyncIterable<Uint8Array> {
    if (!this.closed || this.aborted) throw new Error("sink incomplete");
    for (const chunk of this.chunks) yield chunk.slice();
  }
}

async function* canonicalFileSource(
  files: readonly ArtifactRecordFile[],
  manifests: ArtifactFileManifest[],
): AsyncIterable<Uint8Array> {
  for (const file of files) {
    const fileHash = sha256.create();
    let byteSize = 0;
    let recordCount = 0;
    let previousId: string | undefined;
    for await (const value of asAsync(file.records)) {
      const identity = recordIdentity(value);
      if (previousId && compareCanonicalStrings(previousId, identity) >= 0) {
        throw new FieldSecurityError("field_artifact_invalid");
      }
      previousId = identity;
      const valueLine = fieldTextEncoder.encode(`${canonicalStringify(value)}\n`);
      const envelopeLine = fieldTextEncoder.encode(
        `${canonicalStringify({ path: file.path, recordType: file.recordType, value })}\n`,
      );
      if (envelopeLine.length > maxCanonicalLineBytes) {
        throw new FieldSecurityError("field_artifact_invalid");
      }
      fileHash.update(valueLine);
      byteSize += valueLine.length;
      recordCount += 1;
      yield envelopeLine;
    }
    if (recordCount === 0) continue;
    manifests.push({
      path: file.path,
      recordType: file.recordType,
      recordCount,
      byteSize,
      sha256: hex(fileHash.digest()),
    });
  }
  if (manifests.length === 0) throw new FieldSecurityError("field_artifact_invalid");
}

async function* fixedSizeChunks(
  source: AsyncIterable<Uint8Array>,
  chunkSize: number,
): AsyncIterable<Uint8Array> {
  let retained = new Uint8Array(chunkSize);
  let used = 0;
  for await (const bytes of source) {
    let offset = 0;
    while (offset < bytes.length) {
      const count = Math.min(chunkSize - used, bytes.length - offset);
      retained.set(bytes.subarray(offset, offset + count), used);
      used += count;
      offset += count;
      if (used === chunkSize) {
        yield retained;
        retained = new Uint8Array(chunkSize);
        used = 0;
      }
    }
  }
  if (used > 0) yield retained.slice(0, used);
}

class BoundedByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private offset = 0;
  private observer?: (bytes: Uint8Array) => void;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  observe(observer: (bytes: Uint8Array) => void): void {
    this.observer = observer;
  }

  async readExact(length: number): Promise<Uint8Array> {
    if (length < 0 || length > maxFrameBytes + maxPreambleBytes) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      if (this.offset === this.buffer.length) {
        const next = await this.iterator.next();
        if (next.done) throw new FieldSecurityError("field_artifact_incomplete");
        this.buffer = next.value;
        this.offset = 0;
      }
      const count = Math.min(length - written, this.buffer.length - this.offset);
      output.set(this.buffer.subarray(this.offset, this.offset + count), written);
      this.offset += count;
      written += count;
    }
    this.observer?.(output);
    return output;
  }

  async isDone(): Promise<boolean> {
    if (this.offset < this.buffer.length) return false;
    return (await this.iterator.next()).done === true;
  }
}

class CanonicalLineValidator {
  private retained = new Uint8Array(0);
  private readonly files = new Map<
    string,
    {
      byteSize: number;
      hash: ReturnType<typeof sha256.create>;
      recordCount: number;
      recordType: string;
    }
  >();
  private previousPath = "";
  private previousId = "";

  constructor(
    private readonly onRecord: (record: {
      path: string;
      recordType: string;
      value: unknown;
    }) => Promise<void> | void,
  ) {}

  async push(bytes: Uint8Array): Promise<void> {
    const joined = concatBytes(this.retained, bytes);
    let start = 0;
    for (let index = 0; index < joined.length; index += 1) {
      if (joined[index] !== 10) continue;
      await this.process(joined.subarray(start, index));
      start = index + 1;
    }
    this.retained = joined.slice(start);
    if (this.retained.length > maxCanonicalLineBytes) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
  }

  async close(): Promise<void> {
    if (this.retained.length !== 0) throw new FieldSecurityError("field_artifact_incomplete");
  }

  manifests(): ArtifactFileManifest[] {
    return [...this.files.entries()].map(([path, file]) => ({
      path,
      recordType: file.recordType,
      recordCount: file.recordCount,
      byteSize: file.byteSize,
      sha256: hex(file.hash.digest()),
    }));
  }

  private async process(line: Uint8Array): Promise<void> {
    const text = fieldTextDecoder.decode(line);
    const parsed = JSON.parse(text) as { path?: unknown; recordType?: unknown; value?: unknown };
    if (
      typeof parsed.path !== "string" ||
      typeof parsed.recordType !== "string" ||
      canonicalStringify(parsed) !== text
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    const id = recordIdentity(parsed.value);
    if (
      (parsed.path === this.previousPath && compareCanonicalStrings(id, this.previousId) <= 0) ||
      (this.previousPath && compareCanonicalStrings(parsed.path, this.previousPath) < 0)
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    this.previousPath = parsed.path;
    this.previousId = id;
    let file = this.files.get(parsed.path);
    if (!file) {
      file = { byteSize: 0, hash: sha256.create(), recordCount: 0, recordType: parsed.recordType };
      this.files.set(parsed.path, file);
    } else if (file.recordType !== parsed.recordType) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    const valueLine = fieldTextEncoder.encode(`${canonicalStringify(parsed.value)}\n`);
    file.hash.update(valueLine);
    file.byteSize += valueLine.length;
    file.recordCount += 1;
    await this.onRecord({ path: parsed.path, recordType: parsed.recordType, value: parsed.value });
  }
}

function assertFileOrder(files: readonly ArtifactRecordFile[]): void {
  let previous = "";
  const seen = new Set<string>();
  for (const file of files) {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9]+)?$/u.test(file.path) || seen.has(file.path)) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    if (previous && compareCanonicalStrings(previous, file.path) >= 0) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    previous = file.path;
    seen.add(file.path);
  }
}

function assertPreambleDispatch(preamble: ArtifactPreamble): void {
  const expected =
    preamble.artifactKind === "field_recovery"
      ? FIELD_RECOVERY_CONTAINER_VERSION
      : FIELD_BATCH_CONTAINER_VERSION;
  if (preamble.containerVersion !== expected) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
}

function payloadAad(preamble: ArtifactPreamble, index: number): Uint8Array {
  return fieldTextEncoder.encode(
    canonicalStringify({
      domain: "field-artifact-payload-chunk.v1",
      artifactId: preamble.artifactId,
      artifactKind: preamble.artifactKind,
      transferId: preamble.transferId,
      index,
    }),
  );
}

function rootAad(preamble: ArtifactPreamble): Uint8Array {
  return fieldTextEncoder.encode(
    canonicalStringify({
      domain: "field-artifact-root-manifest.v1",
      artifactId: preamble.artifactId,
      artifactKind: preamble.artifactKind,
      transferId: preamble.transferId,
    }),
  );
}

function magicForKind(kind: ArtifactKind): Uint8Array {
  return kind === "field_recovery" ? FIELD_RECOVERY_MAGIC : FIELD_BATCH_MAGIC;
}

function recordIdentity(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length < 1) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  return id;
}

async function* asAsync(values: AsyncIterable<unknown> | Iterable<unknown>) {
  for await (const value of values) yield value;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function uint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function readUint32(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
