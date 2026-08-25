export const serviceWorkerSource = String.raw`
const FIELD_CACHE_PREFIX = "ask-siargao-field-shell-";
const FIELD_SHELL_PATH = "/operator/field/offline-shell";
const FIELD_ACTIVE_BUILD_CACHE = FIELD_CACHE_PREFIX + "active";
const FIELD_ACTIVE_BUILD_PATH = "/__ask-siargao-active-field-build__";
const FIELD_DEPENDENCY_MANIFEST_PATH = "/__ask-siargao-field-shell-dependencies__";
let activeVisit = true;

self.addEventListener("install", () => {
  // Never skip waiting implicitly. An active Visit pins its existing shell and chunks.
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "ACTIVATE_SAFE_FIELD_UPDATE" && activeVisit === false) {
    self.skipWaiting();
    return;
  }
  if (
    data.type === "FIELD_VISIT_STATE" &&
    typeof data.activeVisit === "boolean" &&
    typeof data.buildId === "string" &&
    /^[A-Za-z0-9._-]{1,200}$/.test(data.buildId)
  ) {
    activeVisit = data.activeVisit;
    event.waitUntil(selectPreparedBuild(data.buildId));
    return;
  }
  if (
    data.type !== "PREPARE_FIELD_OFFLINE" ||
    data.shellPath !== FIELD_SHELL_PATH ||
    typeof data.buildId !== "string" ||
    !/^[A-Za-z0-9._-]{1,200}$/.test(data.buildId) ||
    typeof data.preparationId !== "string" ||
    !/^[A-Za-z0-9-]{16,200}$/.test(data.preparationId)
  ) return;
  activeVisit = data.activeVisit === true;
  event.waitUntil(
    prepareShell(data.buildId).then(() => selectPreparedBuild(data.buildId, data.preparationId)),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.searchParams.has("_rsc")) return;
  if (request.destination === "document" && url.pathname.startsWith("/operator/field/")) {
    event.respondWith(fetch(request).catch(() => matchPreparedShell()));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") && isSafeStaticRequest(request)) {
    event.respondWith(matchPreparedAsset(request).then((cached) => cached || fetch(request)));
  }
});

async function prepareShell(buildId) {
  const cache = await caches.open(FIELD_CACHE_PREFIX + buildId);
  await Promise.all([
    cache.delete(FIELD_SHELL_PATH),
    cache.delete(FIELD_DEPENDENCY_MANIFEST_PATH),
  ]);
  const response = await fetch(FIELD_SHELL_PATH, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "x-field-offline-prepare": "1" },
  });
  if (!response.ok || response.headers.get("content-type")?.includes("text/html") !== true) {
    throw new Error("field_shell_prepare_failed");
  }
  const html = await response.text();
  const staticPaths = extractStaticDependencies(html);
  if (staticPaths.length === 0) throw new Error("field_static_manifest_empty");
  await Promise.all(staticPaths.map(async (path) => {
    const asset = await fetch(path, { cache: "reload", credentials: "omit" });
    if (!asset.ok) throw new Error("field_static_asset_prepare_failed");
    await cache.put(path, asset);
  }));
  await cache.put(
    FIELD_SHELL_PATH,
    new Response(html, { headers: response.headers, status: response.status }),
  );
  await cache.put(
    FIELD_DEPENDENCY_MANIFEST_PATH,
    new Response(JSON.stringify({ assets: staticPaths, version: 1 }), {
      headers: { "content-type": "application/json" },
    }),
  );
}

async function matchPreparedShell() {
  const activeBuildId = await readActiveBuildId();
  if (activeBuildId) {
    const cache = await caches.open(FIELD_CACHE_PREFIX + activeBuildId);
    if (!(await isPreparedCacheComplete(cache))) return unavailableShellResponse();
    const cached = await cache.match(FIELD_SHELL_PATH);
    if (cached) return cached;
  }
  return unavailableShellResponse();
}

async function matchPreparedAsset(request) {
  const activeBuildId = await readActiveBuildId();
  if (!activeBuildId) return undefined;
  return (await caches.open(FIELD_CACHE_PREFIX + activeBuildId)).match(request);
}

function unavailableShellResponse() {
  return new Response("Field offline shell unavailable", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 503,
  });
}

async function selectPreparedBuild(buildId, preparationId) {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(buildId)) return;
  const preparedCache = await caches.open(FIELD_CACHE_PREFIX + buildId);
  if (!(await isPreparedCacheComplete(preparedCache))) return;
  const activeCache = await caches.open(FIELD_ACTIVE_BUILD_CACHE);
  let selectedPreparationId = preparationId;
  if (!selectedPreparationId) {
    const existing = await activeCache.match(FIELD_ACTIVE_BUILD_PATH);
    try {
      const selected = existing ? await existing.json() : undefined;
      if (selected?.buildId === buildId) selectedPreparationId = selected.preparationId;
    } catch {
      // Replace an invalid marker only after complete cache validation succeeds.
    }
  }
  await activeCache.put(
    FIELD_ACTIVE_BUILD_PATH,
    new Response(JSON.stringify({ buildId, preparationId: selectedPreparationId }), {
      headers: { "content-type": "application/json" },
    }),
  );
}

async function isPreparedCacheComplete(cache) {
  const [shell, manifestResponse] = await Promise.all([
    cache.match(FIELD_SHELL_PATH),
    cache.match(FIELD_DEPENDENCY_MANIFEST_PATH),
  ]);
  if (!shell || !manifestResponse) return false;
  const html = await shell.clone().text();
  const staticPaths = extractStaticDependencies(html);
  let manifest;
  try {
    manifest = await manifestResponse.json();
  } catch {
    return false;
  }
  if (
    manifest?.version !== 1 ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length !== staticPaths.length ||
    !manifest.assets.every((path, index) => path === staticPaths[index])
  ) return false;
  for (const path of staticPaths) {
    if (!(await cache.match(path))) return false;
  }
  return true;
}

function extractStaticDependencies(html) {
  const paths = new Set();
  for (const match of html.matchAll(/(?:\/_next\/)?static\/(?:chunks|css|media)\/[A-Za-z0-9._%/-]+/g)) {
    const path = match[0].startsWith("/_next/") ? match[0] : "/_next/" + match[0];
    if (isSafeStaticPath(path)) paths.add(path);
  }
  return [...paths].sort();
}

function isSafeStaticPath(path) {
  return /^\/_next\/static\/(?:chunks|css|media)\/[A-Za-z0-9._%/-]+$/.test(path) &&
    !path.includes("..");
}

async function readActiveBuildId() {
  const activeCache = await caches.open(FIELD_ACTIVE_BUILD_CACHE);
  const response = await activeCache.match(FIELD_ACTIVE_BUILD_PATH);
  if (!response) return undefined;
  try {
    const data = await response.json();
    return typeof data.buildId === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(data.buildId)
      ? data.buildId
      : undefined;
  } catch {
    return undefined;
  }
}

function isSafeStaticRequest(request) {
  return ["script", "style", "font", "image"].includes(request.destination);
}
`;
