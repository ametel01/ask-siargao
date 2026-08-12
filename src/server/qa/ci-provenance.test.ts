import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("ordinary CI actions and service images are immutable", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
  const imageReferences = [...workflow.matchAll(/^\s+image:\s+([^\s#]+)/gm)].map(
    (match) => match[1],
  );

  expect(actionReferences.length).toBeGreaterThan(0);
  expect(imageReferences.length).toBeGreaterThan(0);
  for (const action of actionReferences) {
    expect(action).toMatch(/@[0-9a-f]{40}$/);
  }
  for (const image of imageReferences) {
    expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
  }
  const checkoutSteps = workflow.match(
    /- uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+persist-credentials: false/g,
  );
  expect(checkoutSteps).toHaveLength(4);
});
