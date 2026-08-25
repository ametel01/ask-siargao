import { expect, test } from "bun:test";

import { serviceWorkerSource } from "./source";

test("selects the explicitly prepared field build instead of lexical cache order", () => {
  expect(serviceWorkerSource).toContain(
    'const FIELD_ACTIVE_BUILD_CACHE = FIELD_CACHE_PREFIX + "active"',
  );
  expect(serviceWorkerSource).toContain(
    "prepareShell(data.buildId).then(() => selectPreparedBuild(data.buildId, data.preparationId))",
  );
  expect(serviceWorkerSource).toContain("const activeBuildId = await readActiveBuildId()");
  expect(serviceWorkerSource).not.toContain("keys.reverse()");
  expect(serviceWorkerSource).not.toContain(
    ".filter((key) => key.startsWith(FIELD_CACHE_PREFIX)).sort()",
  );
  expect(serviceWorkerSource).toContain("async function isPreparedCacheComplete(cache)");
  expect(serviceWorkerSource).toContain(
    "if (!(await isPreparedCacheComplete(preparedCache))) return;",
  );
  expect(serviceWorkerSource).toContain(
    'const FIELD_DEPENDENCY_MANIFEST_PATH = "/__ask-siargao-field-shell-dependencies__"',
  );
  expect(serviceWorkerSource).toContain("const staticPaths = extractStaticDependencies(html)");
  expect(serviceWorkerSource).toContain("manifest.assets.length !== staticPaths.length");
  expect(serviceWorkerSource).toContain("matchPreparedAsset(request)");
  expect(serviceWorkerSource).not.toContain("caches.match(request)");
});
