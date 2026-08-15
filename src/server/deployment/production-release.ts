import { appendFile } from "node:fs/promises";

import {
  createStagedProductionDeployment,
  promoteProductionDeployment,
  waitForLiveProductionDeployment,
} from "@/server/deployment/vercel-production-api";

const command = process.argv[2];
const token = requiredEnvironment("VERCEL_TOKEN");
const teamId = requiredEnvironment("VERCEL_ORG_ID");
const projectId = requiredEnvironment("VERCEL_PROJECT_ID");

if (command === "deploy") {
  const releaseSha = requiredEnvironment("RELEASE_SHA");
  const deployment = await createStagedProductionDeployment({
    projectId,
    releaseSha,
    repositoryId: requiredEnvironment("GITHUB_REPOSITORY_ID"),
    teamId,
    token,
  });
  await writeOutput("deployment_id", deployment.id);
  await writeOutput("deployment_url", deployment.url);
  console.log(JSON.stringify({ status: "ready", deploymentId: deployment.id, releaseSha }));
} else if (command === "promote") {
  const deploymentId = requiredEnvironment("PRODUCTION_DEPLOYMENT_ID");
  await promoteProductionDeployment({ deploymentId, projectId, teamId, token });
  await waitForLiveProductionDeployment({
    deploymentId,
    productionOrigin: requiredEnvironment("PRODUCTION_APP_ORIGIN"),
    teamId,
    token,
  });
  console.log(JSON.stringify({ status: "promoted", deploymentId }));
} else {
  throw new Error("Production release command must be deploy or promote.");
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function writeOutput(name: string, value: string) {
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${value}\n`, { encoding: "utf8" });
}
