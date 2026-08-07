import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const fixtureCleanupPaths = [
  ".agents/biome-scope-fixture",
  ".github/skills/biome-scope-fixture",
  ".github/workflows/biome-scope-fixture.ts",
  "src/biome-scope-fixture",
];

describe("Biome effective repository scope", () => {
  afterEach(cleanupFixtures);

  test("ignores imported bundles while linting first-party source and workflow paths", async () => {
    await cleanupFixtures();
    await writeFixture(".agents/biome-scope-fixture/imported-bundle.ts", "const imported = 1\n");
    await writeFixture(".github/skills/biome-scope-fixture/imported-skill.ts", "const skill = 1\n");

    expect(await runLint()).toMatchObject({ exitCode: 0 });

    await writeFixture("src/biome-scope-fixture/source.ts", "const firstParty = 1\n");
    const sourceResult = await runLint();

    expect(sourceResult.exitCode).not.toBe(0);
    expect(sourceResult.output).toContain("src/biome-scope-fixture/source.ts");

    await rm("src/biome-scope-fixture", { force: true, recursive: true });
    await writeFixture(".github/workflows/biome-scope-fixture.ts", "const workflow = 1\n");
    const workflowResult = await runLint();

    expect(workflowResult.exitCode).not.toBe(0);
    expect(workflowResult.output).toContain(".github/workflows/biome-scope-fixture.ts");
  });
});

async function writeFixture(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function cleanupFixtures() {
  await Promise.all(
    fixtureCleanupPaths.map((fixturePath) => rm(fixturePath, { force: true, recursive: true })),
  );
}

async function runLint() {
  const proc = Bun.spawn(["bun", "run", "lint"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode,
    output: `${stdout}\n${stderr}`,
  };
}
