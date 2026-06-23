import { redactDiagnosticValue } from "@/server/admin/redaction";
import type { IntakeInput } from "@/server/audit/schemas";

export function sanitizeIntakeForMetrics(input: IntakeInput) {
  return {
    hasAccommodationName: Boolean(input.accommodationName),
    hasAccommodationPlatformUrl: Boolean(input.accommodationPlatformUrl),
    hasStayArea: Boolean(input.stayAreaSlug),
    hasTravelMonth: Boolean(input.travelMonth),
    optionalModuleCount: input.optionalModules.length,
    riskTolerance: input.travelerContext.riskTolerance,
    travelerTypePresent: Boolean(input.travelerContext.travelerType),
    groupSizeBucket: bucketGroupSize(input.travelerContext.groupSize),
  };
}

export function sanitizeForTelemetry(payload: Record<string, unknown>) {
  return redactDiagnosticValue(payload) as Record<string, unknown>;
}

export function getServerSecret(
  name: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (name.startsWith("NEXT_PUBLIC_")) {
    throw new Error(`Refusing to read public environment variable ${name} as a server secret.`);
  }

  return env[name];
}

function bucketGroupSize(groupSize: number | undefined) {
  if (!groupSize) {
    return "unknown";
  }
  if (groupSize === 1) {
    return "solo";
  }
  if (groupSize <= 4) {
    return "small";
  }

  return "large";
}
