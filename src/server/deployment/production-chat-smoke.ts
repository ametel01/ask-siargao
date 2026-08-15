import {
  modelProviderConsentCookieName,
  modelProviderConsentVersion,
} from "@/lib/model-provider-consent";
import { createProtectedDeploymentRequest } from "@/server/deployment/vercel-production-api";

type SmokeHttpResult = {
  body: unknown;
  status: number;
};

type ProductionChatSmokeDependencies = {
  request?: (path: string, init?: RequestInit) => Promise<SmokeHttpResult>;
};

const defaultProductionOrigin = "https://www.asksiargao.com";
const consentCookie = `${modelProviderConsentCookieName}=${modelProviderConsentVersion}`;
const diagnosticPrompt =
  "Answer in one short sentence: Which Philippine island is the Cloud 9 surf break on?";

export async function runProductionChatSmoke(dependencies: ProductionChatSmokeDependencies = {}) {
  const request = dependencies.request ?? (await createSmokeRequest());
  const health = await request("/api/health/ready");
  assertReadyHealth(health);

  const chat = await request("/api/chat", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: consentCookie,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: diagnosticPrompt }],
    }),
  });
  const evidence = assertDeepSeekChat(chat);
  console.log(
    JSON.stringify({
      status: "passed",
      health: "ready",
      chat: "deepseek",
      model: evidence.model,
      answerContainsSiargao: true,
    }),
  );
  return evidence;
}

export function assertReadyHealth(result: SmokeHttpResult) {
  const body = recordFromUnknown(result.body);
  if (result.status !== 200 || body.status !== "ready") {
    throw new Error(`Production readiness smoke failed with HTTP ${result.status}.`);
  }
}

export function assertDeepSeekChat(result: SmokeHttpResult) {
  const body = recordFromUnknown(result.body);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Production chat smoke failed with HTTP ${result.status}.`);
  }
  if (!message || !/siargao/i.test(message)) {
    throw new Error("Production chat smoke did not return the expected Siargao answer.");
  }
  if (!/deepseek/i.test(model)) {
    throw new Error("Production chat smoke did not use a DeepSeek model.");
  }
  if (body.completionStatus === "completed_with_limits") {
    throw new Error("Production chat smoke returned only a limited answer candidate.");
  }
  return { message, model };
}

async function createSmokeRequest() {
  const deployment = process.env.PRODUCTION_SMOKE_DEPLOYMENT?.trim();
  if (deployment) {
    return createProtectedDeploymentRequest({
      deploymentOrigin: deployment,
      projectId: requiredEnvironment("VERCEL_PROJECT_ID"),
      teamId: requiredEnvironment("VERCEL_ORG_ID"),
      token: requiredEnvironment("VERCEL_TOKEN"),
    });
  }
  const origin = process.env.PRODUCTION_APP_ORIGIN?.trim() || defaultProductionOrigin;
  const normalizedOrigin = new URL(origin).origin;
  return async (path: string, init?: RequestInit) => {
    const response = await fetch(`${normalizedOrigin}${path}`, init);
    if (!response.ok) {
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    }
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a staged production smoke.`);
  return value;
}

if (import.meta.main) {
  try {
    await runProductionChatSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production chat smoke failed.");
    process.exit(1);
  }
}
