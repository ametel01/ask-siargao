export type VercelFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type VercelDeployment = {
  id?: unknown;
  meta?: unknown;
  readyState?: unknown;
  target?: unknown;
  url?: unknown;
};

type VercelProject = {
  protectionBypass?: unknown;
};

type VercelProductionApiOptions = {
  fetch?: VercelFetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const vercelApiOrigin = "https://api.vercel.com";

export async function createStagedProductionDeployment(
  input: {
    projectId: string;
    releaseSha: string;
    repositoryId: string;
    teamId: string;
    token: string;
  },
  options: VercelProductionApiOptions = {},
) {
  const deployment = await requestVercelJson<VercelDeployment>(
    `/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1&teamId=${encodeURIComponent(input.teamId)}`,
    input.token,
    {
      method: "POST",
      body: JSON.stringify({
        name: "ask-siargao",
        project: input.projectId,
        target: "production",
        autoAssignCustomDomains: false,
        gitSource: {
          type: "github",
          ref: "main",
          repoId: input.repositoryId,
          sha: input.releaseSha,
        },
        meta: {
          githubCommitRef: "main",
          githubCommitRepo: "ametel01/ask-siargao",
          githubCommitSha: input.releaseSha,
        },
      }),
    },
    options.fetch,
  );
  const identity = deploymentIdentity(deployment);
  return waitForDeploymentReady(identity.id, input, options);
}

export async function waitForDeploymentReady(
  deploymentId: string,
  input: { releaseSha: string; teamId: string; token: string },
  options: VercelProductionApiOptions = {},
) {
  const deployment = await pollUntil(
    async () =>
      requestVercelJson<VercelDeployment>(
        `/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(input.teamId)}`,
        input.token,
        undefined,
        options.fetch,
      ),
    (candidate) => candidate.readyState === "READY",
    (candidate) => candidate.readyState === "ERROR" || candidate.readyState === "CANCELED",
    options,
  );
  const identity = deploymentIdentity(deployment);
  const meta = recordFromUnknown(deployment.meta);
  if (deployment.target !== "production" || meta.githubCommitSha !== input.releaseSha) {
    throw new Error("Vercel staged deployment does not match the exact production release SHA.");
  }
  return identity;
}

export async function promoteProductionDeployment(
  input: { deploymentId: string; projectId: string; teamId: string; token: string },
  options: VercelProductionApiOptions = {},
) {
  await requestVercel(
    `/v10/projects/${encodeURIComponent(input.projectId)}/promote/${encodeURIComponent(input.deploymentId)}?teamId=${encodeURIComponent(input.teamId)}`,
    input.token,
    { method: "POST", body: "{}" },
    options.fetch,
  );
}

export async function waitForLiveProductionDeployment(
  input: {
    deploymentId: string;
    productionOrigin: string;
    teamId: string;
    token: string;
  },
  options: VercelProductionApiOptions = {},
) {
  const hostname = new URL(input.productionOrigin).hostname;
  await pollUntil(
    () =>
      requestVercelJson<VercelDeployment>(
        `/v13/deployments/${encodeURIComponent(hostname)}?teamId=${encodeURIComponent(input.teamId)}`,
        input.token,
        undefined,
        options.fetch,
      ),
    (deployment) => deployment.id === input.deploymentId && deployment.readyState === "READY",
    (deployment) => deployment.readyState === "ERROR" || deployment.readyState === "CANCELED",
    options,
  );
}

export async function createProtectedDeploymentRequest(
  input: { deploymentOrigin: string; projectId: string; teamId: string; token: string },
  options: VercelProductionApiOptions = {},
) {
  const bypassSecret = await getOrCreateAutomationBypassSecret(input, options.fetch);
  const origin = new URL(input.deploymentOrigin).origin;
  const requestFetch = options.fetch ?? fetch;
  return async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("x-vercel-protection-bypass", bypassSecret);
    const response = await requestFetch(`${origin}${path}`, { ...init, headers });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  };
}

async function getOrCreateAutomationBypassSecret(
  input: { projectId: string; teamId: string; token: string },
  requestFetch: VercelFetch = fetch,
) {
  const project = await requestVercelJson<VercelProject>(
    `/v9/projects/${encodeURIComponent(input.projectId)}?teamId=${encodeURIComponent(input.teamId)}`,
    input.token,
    undefined,
    requestFetch,
  );
  const existing = automationBypassSecret(project.protectionBypass);
  if (existing) return existing;

  const updated = await requestVercelJson<VercelProject>(
    `/v1/projects/${encodeURIComponent(input.projectId)}/protection-bypass?teamId=${encodeURIComponent(input.teamId)}`,
    input.token,
    { method: "PATCH", body: "{}" },
    requestFetch,
  );
  const created = automationBypassSecret(updated.protectionBypass);
  if (!created) throw new Error("Vercel did not return an automation bypass secret.");
  return created;
}

function automationBypassSecret(value: unknown) {
  const entries = Object.entries(recordFromUnknown(value));
  return entries.find(
    ([, metadata]) => recordFromUnknown(metadata).scope === "automation-bypass",
  )?.[0];
}

async function requestVercelJson<T = Record<string, unknown>>(
  path: string,
  token: string,
  init: RequestInit = {},
  requestFetch: VercelFetch = fetch,
): Promise<T> {
  const response = await requestVercel(path, token, init, requestFetch);
  return (await response.json()) as T;
}

async function requestVercel(
  path: string,
  token: string,
  init: RequestInit = {},
  requestFetch: VercelFetch = fetch,
) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  const response = await requestFetch(`${vercelApiOrigin}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`Vercel API request failed with HTTP ${response.status}.`);
  }
  return response;
}

async function pollUntil<T>(
  load: () => Promise<T>,
  complete: (value: T) => boolean,
  failed: (value: T) => boolean,
  options: VercelProductionApiOptions,
) {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  while (Date.now() < deadline) {
    const value = await load();
    if (complete(value)) return value;
    if (failed(value)) throw new Error("Vercel production operation failed.");
    await Bun.sleep(pollIntervalMs);
  }
  throw new Error("Vercel production operation timed out.");
}

function deploymentIdentity(deployment: VercelDeployment) {
  if (typeof deployment.id !== "string" || typeof deployment.url !== "string") {
    throw new Error("Vercel returned an invalid deployment identity.");
  }
  return { id: deployment.id, url: `https://${deployment.url}` };
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
