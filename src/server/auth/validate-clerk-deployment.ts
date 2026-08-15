import { requireClerkDeploymentConfig } from "@/server/auth/clerk-deployment-config";
import { requireValidProductionModelCostCircuit } from "@/server/chat/cost-circuits";
import { requireValidChatModelDeployment } from "@/server/llm/chat-model-provider";
import { requireValidForecastProviderDeployment } from "@/server/providers/production-provider-mode";
import { requireValidWebResearchDeployment } from "@/server/providers/web-search";
import { requireValidTripPassCheckoutMode } from "@/server/trip-pass/catalog";

try {
  const config = requireClerkDeploymentConfig();
  requireValidProductionModelCostCircuit();
  const chatProvider = requireValidChatModelDeployment();
  const forecastProviders = requireValidForecastProviderDeployment();
  const webResearch = requireValidWebResearchDeployment();
  const checkoutMode = requireValidTripPassCheckoutMode();
  console.log(
    `Deployment configuration valid: Clerk ${config.context}/${config.mode}; chat ${chatProvider}; Open-Meteo ${forecastProviders.openMeteo}; Tide-Forecast ${forecastProviders.tideForecast}; public-web research ${webResearch}; Trip Pass checkout ${checkoutMode}.`,
  );
} catch (error) {
  console.error("Invalid deployment configuration.");
  console.error(error instanceof Error ? error.message : "Unknown deployment configuration error.");
  process.exit(1);
}
