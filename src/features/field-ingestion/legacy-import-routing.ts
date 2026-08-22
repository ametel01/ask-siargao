export const canonicalLegacyImportRoute =
  "/operator/field/diagnostics-recovery/legacy-import" as const;

export type LegacyImportAliasMode = "fallback" | "redirect";

export function legacyImportAliasMode(value: string | undefined): LegacyImportAliasMode {
  return value === "fallback" ? "fallback" : "redirect";
}
