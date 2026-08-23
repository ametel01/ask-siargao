import { expect, test } from "bun:test";

import { serviceWorkerSource } from "./source";

test("selects the explicitly prepared field build instead of lexical cache order", () => {
  expect(serviceWorkerSource).toContain(
    'const FIELD_ACTIVE_BUILD_CACHE = FIELD_CACHE_PREFIX + "active"',
  );
  expect(serviceWorkerSource).toContain(
    "prepareShell(data.buildId).then(() => selectPreparedBuild(data.buildId))",
  );
  expect(serviceWorkerSource).toContain("const activeBuildId = await readActiveBuildId()");
  expect(serviceWorkerSource).not.toContain("keys.reverse()");
  expect(serviceWorkerSource).not.toContain(
    ".filter((key) => key.startsWith(FIELD_CACHE_PREFIX)).sort()",
  );
});
