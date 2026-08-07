import { requireClerkDeploymentConfig } from "@/server/auth/clerk-deployment-config";

try {
  const config = requireClerkDeploymentConfig();
  console.log(`Clerk deployment configuration valid: ${config.context}/${config.mode}`);
} catch (error) {
  console.error("Invalid Clerk deployment configuration.");
  console.error(error instanceof Error ? error.message : "Unknown Clerk configuration error.");
  process.exit(1);
}
