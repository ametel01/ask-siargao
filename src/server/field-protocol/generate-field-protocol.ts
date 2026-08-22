import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { compile, type JSONSchema } from "json-schema-to-typescript";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { fieldProtocolPackageComponents } from "@/features/field-protocol/package-components";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const canonicalDirectory = join(repositoryRoot, "field-protocol/canonical/v1");
const trustFile = join(repositoryRoot, "field-protocol/trust/trusted-signers.v1.json");
const manifestFile = join(canonicalDirectory, "manifest.v1.json");
const generatedDirectory = join(repositoryRoot, "src/features/field-protocol/generated");
const checkOnly = process.argv.includes("--check");
const privateKeyArgument = process.argv.find((argument) =>
  argument.startsWith("--sign-private-key="),
);

type JsonObject = Record<string, unknown>;

async function main() {
  if (privateKeyArgument) {
    if (checkOnly) throw new Error("--check cannot be combined with --sign-private-key.");
    await signManifest(privateKeyArgument.slice("--sign-private-key=".length));
  }

  const artifacts = await readCanonicalArtifacts();
  const trust = await readJson(trustFile);
  const manifest = artifacts["manifest.v1.json"];
  if (!manifest) {
    throw new Error("manifest.v1.json is missing; sign the package before generating bindings.");
  }

  await assertManifestHashes(manifest, artifacts);

  const schemas = requiredObject(artifacts["schemas.v1.json"], "records");
  const distributionSchemas = requiredObject(artifacts["distribution-schemas.v1.json"], "schemas");
  const generatedFiles = new Map<string, string>();

  for (const [name, schema] of Object.entries({ ...schemas, ...distributionSchemas })) {
    const schemaObject = requiredJsonObject(schema, `schema ${name}`) as JSONSchema;
    const typeName = requiredString(schemaObject.title, `schema ${name} title`);
    const content = await compile(schemaObject, typeName, {
      bannerComment: "// Generated from field-protocol/canonical/v1. Do not edit by hand.\n",
      format: false,
      unknownAny: true,
    });
    generatedFiles.set(
      join(generatedDirectory, `${kebabCase(name)}.generated.ts`),
      await formatTypeScript(content, `${kebabCase(name)}.generated.ts`),
    );
  }

  const observationKinds = requiredArray(artifacts["observation-kinds.v1.json"], "kinds");
  const observationTypes: string[] = [
    "// Generated from field-protocol/canonical/v1/observation-kinds.v1.json. Do not edit by hand.",
    "",
  ];
  const mappings: string[] = [];
  for (const entry of observationKinds) {
    const kind = requiredString(requiredJsonObject(entry, "observation kind").kind, "kind");
    const typeName = `${pascalCase(kind)}ObservationValue`;
    const schema = requiredJsonObject(
      requiredJsonObject(entry, `observation kind ${kind}`).valueSchema,
      `observation kind ${kind} valueSchema`,
    ) as JSONSchema;
    const generated = await compile(schema, typeName, {
      bannerComment: "",
      format: false,
      unknownAny: true,
    });
    observationTypes.push(generated.trim(), "");
    mappings.push(`  ${JSON.stringify(kind)}: ${typeName};`);
  }
  observationTypes.push(
    "export interface ObservationValueByKind {",
    ...mappings,
    "}",
    "",
    "export type ObservationKind = keyof ObservationValueByKind;",
    "",
  );
  generatedFiles.set(
    join(generatedDirectory, "observation-values.generated.ts"),
    await formatTypeScript(observationTypes.join("\n"), "observation-values.generated.ts"),
  );

  const packageData = {
    ...Object.fromEntries(
      fieldProtocolPackageComponents.map((component) => [
        component.key,
        artifacts[component.filename],
      ]),
    ),
    manifest,
  };
  const embedded = [
    "// Generated from field-protocol/canonical/v1. Do not edit by hand.",
    `export const baselineFieldProtocolPackageData = ${JSON.stringify(packageData, null, 2)} as const;`,
    `export const trustedFieldProtocolSignersData = ${JSON.stringify(trust, null, 2)} as const;`,
    "",
  ].join("\n");
  generatedFiles.set(
    join(generatedDirectory, "baseline-field-protocol.generated.ts"),
    await formatTypeScript(embedded, "baseline-field-protocol.generated.ts"),
  );

  const indexLines = [
    'export { baselineFieldProtocolPackageData, trustedFieldProtocolSignersData } from "./baseline-field-protocol.generated";',
    ...[...generatedFiles.keys()]
      .filter((path) => !path.endsWith("baseline-field-protocol.generated.ts"))
      .sort()
      .map((path) => `export * from "./${basename(path, ".ts")}";`),
    "",
  ];
  generatedFiles.set(
    join(generatedDirectory, "index.ts"),
    await formatTypeScript(indexLines.join("\n"), "index.ts"),
  );

  for (const [path, content] of generatedFiles) {
    await writeGeneratedFile(path, content);
  }
}

async function signManifest(privateKeyPath: string) {
  const artifacts = await readCanonicalArtifacts({ includeManifest: false });
  const files = Object.entries(artifacts).map(([filename, artifact]) => ({
    path: `canonical/v1/${filename}`,
    sha256: createHash("sha256").update(canonicalStringify(artifact)).digest("hex"),
  }));
  files.sort((left, right) => left.path.localeCompare(right.path));

  const unsignedManifest = {
    schemaVersion: "field-protocol-package-manifest.v1",
    packageId: "field-protocol-siargao-baseline",
    packageVersion: "1.0.0",
    createdAt: "2026-08-22T00:00:00.000Z",
    signerKeyId: "ask-siargao-field-protocol-2026-01",
    componentVersions: Object.fromEntries(
      fieldProtocolPackageComponents.map((component) => [
        component.key,
        requiredString(
          requiredJsonObject(artifacts[component.filename], component.filename).componentVersion,
          `${component.filename} componentVersion`,
        ),
      ]),
    ),
    compatibility: {
      minimumApplicationVersion: "0.1.0",
      maximumApplicationVersionExclusive: "1.0.0",
    },
    migrationDeclaration: {
      strategy: "explicit_preview_required",
      supportedFromVersions: ["0.9.0"],
      migrationIds: ["migration_legacy_0_9_0_to_baseline_1_0_0"],
    },
    files,
  };
  const privateKey = createPrivateKey(await readFile(resolve(privateKeyPath)));
  const signature = sign(
    null,
    Buffer.from(canonicalStringify(unsignedManifest)),
    privateKey,
  ).toString("base64");
  await writeFile(
    manifestFile,
    `${JSON.stringify({ ...unsignedManifest, signature: { algorithm: "Ed25519", value: signature } }, null, 2)}\n`,
  );
}

async function readCanonicalArtifacts(options: { includeManifest?: boolean } = {}) {
  const filenames = (await readdir(canonicalDirectory))
    .filter((filename) => filename.endsWith(".json"))
    .filter((filename) => options.includeManifest !== false || filename !== "manifest.v1.json")
    .sort();
  return Object.fromEntries(
    await Promise.all(
      filenames.map(async (filename) => [
        filename,
        await readJson(join(canonicalDirectory, filename)),
      ]),
    ),
  );
}

async function assertManifestHashes(manifestValue: unknown, artifacts: Record<string, unknown>) {
  const manifest = requiredJsonObject(manifestValue, "manifest");
  const files = requiredArray(manifest, "files");
  const expectedFilenames = fieldProtocolPackageComponents.map(({ filename }) => filename).sort();
  const actualFilenames = files
    .map((fileValue) =>
      basename(
        requiredString(requiredJsonObject(fileValue, "manifest file").path, "manifest file path"),
      ),
    )
    .sort();
  if (
    expectedFilenames.length !== actualFilenames.length ||
    expectedFilenames.some((filename, index) => filename !== actualFilenames[index])
  ) {
    throw new Error("Manifest does not contain the complete canonical artifact set.");
  }
  for (const fileValue of files) {
    const file = requiredJsonObject(fileValue, "manifest file");
    const path = requiredString(file.path, "manifest file path");
    const expectedHash = requiredString(file.sha256, `manifest hash for ${path}`);
    const filename = basename(path);
    if (!(filename in artifacts)) throw new Error(`Manifest artifact is missing: ${path}`);
    const actualHash = createHash("sha256")
      .update(canonicalStringify(artifacts[filename]))
      .digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Manifest hash mismatch: ${path}`);
  }
}

async function writeGeneratedFile(path: string, content: string) {
  if (checkOnly) {
    let existing = "";
    try {
      existing = await readFile(path, "utf8");
    } catch {
      throw new Error(`Generated file is missing: ${relative(repositoryRoot, path)}`);
    }
    if (existing !== content) {
      throw new Error(`Generated file is stale: ${relative(repositoryRoot, path)}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function formatTypeScript(content: string, filename: string) {
  const process = Bun.spawn(["bunx", "biome", "format", `--stdin-file-path=${filename}`], {
    cwd: repositoryRoot,
    stdin: Buffer.from(content),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`Biome could not format ${filename}: ${stderr}`);
  return stdout;
}

async function readJson(path: string): Promise<JsonObject> {
  return requiredJsonObject(JSON.parse(await readFile(path, "utf8")), path);
}

function requiredJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function requiredObject(value: unknown, key: string): JsonObject {
  return requiredJsonObject(requiredJsonObject(value, "artifact")[key], key);
}

function requiredArray(value: unknown, key: string): unknown[] {
  const result = requiredJsonObject(value, "artifact")[key];
  if (!Array.isArray(result)) throw new Error(`${key} must be an array.`);
  return result;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a string.`);
  return value;
}

function pascalCase(value: string) {
  return value
    .split(/[_-]/)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function kebabCase(value: string) {
  return value
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

await main();
