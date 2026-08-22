export const serviceWorkerSource = String.raw`
const FIELD_CACHE_PREFIX = "ask-siargao-field-shell-";
const FIELD_SHELL_PATH = "/operator/field/offline-shell";
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
    return;
  }
  if (
    data.type !== "PREPARE_FIELD_OFFLINE" ||
    data.shellPath !== FIELD_SHELL_PATH ||
    typeof data.buildId !== "string" ||
    !/^[A-Za-z0-9._-]{1,200}$/.test(data.buildId)
  ) return;
  activeVisit = data.activeVisit === true;
  event.waitUntil(prepareShell(data.buildId));
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
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});

async function prepareShell(buildId) {
  const cache = await caches.open(FIELD_CACHE_PREFIX + buildId);
  const response = await fetch(FIELD_SHELL_PATH, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "x-field-offline-prepare": "1" },
  });
  if (!response.ok || response.headers.get("content-type")?.includes("text/html") !== true) {
    throw new Error("field_shell_prepare_failed");
  }
  const html = await response.text();
  await cache.put(
    FIELD_SHELL_PATH,
    new Response(html, { headers: response.headers, status: response.status }),
  );
  const staticPaths = [...html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)]
    .map((match) => match[1])
    .filter((path) => !path.includes(".."));
  await Promise.all([...new Set(staticPaths)].map(async (path) => {
    const asset = await fetch(path, { cache: "reload", credentials: "omit" });
    if (asset.ok) await cache.put(path, asset);
  }));
}

async function matchPreparedShell() {
  const keys = (await caches.keys()).filter((key) => key.startsWith(FIELD_CACHE_PREFIX)).sort();
  for (const key of keys.reverse()) {
    const cached = await (await caches.open(key)).match(FIELD_SHELL_PATH);
    if (cached) return cached;
  }
  return new Response("Field offline shell unavailable", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 503,
  });
}

function isSafeStaticRequest(request) {
  return ["script", "style", "font", "image"].includes(request.destination);
}
`;
