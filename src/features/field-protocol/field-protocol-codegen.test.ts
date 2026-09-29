import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const referencePath = "documentation/developer/reference/field-research-data-model.md";

test("canonical Field Protocol Package generated output is stable", async () => {
  const generation = Bun.spawn(["bun", "run", "field-protocol:check"], {
    cwd: repositoryRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    generation.exited,
    new Response(generation.stderr).text(),
    new Response(generation.stdout).text(),
  ]);

  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});

test("Field Protocol Package reference links and domain terminology stay aligned", async () => {
  const [reference, context] = await Promise.all([
    readFile(resolve(repositoryRoot, referencePath), "utf8"),
    readFile(resolve(repositoryRoot, "CONTEXT.md"), "utf8"),
  ]);

  for (const term of [
    "Field Protocol Package",
    "Protocol Migration",
    "Observation Kind",
    "Method Profile",
    "Field Recovery Export",
    "Field Batch",
    "Schema Gap",
  ]) {
    expect(reference).toContain(term);
    expect(context).toContain(`**${term}**`);
  }
  expect(reference).toContain("Implemented by issue #238");
  expect(reference).toContain("## Future server boundary");

  for (const match of reference.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]?.split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:|\/)/.test(target)) continue;
    await expect(
      Bun.file(resolve(repositoryRoot, dirname(referencePath), target)).exists(),
    ).resolves.toBe(true);
  }
});
