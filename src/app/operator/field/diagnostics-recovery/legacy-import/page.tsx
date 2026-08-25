import type { Metadata } from "next";

import { LegacyImportDiagnostics } from "@/features/field-ingestion/LegacyImportDiagnostics";
import { FieldMain } from "@/features/field-workspace/FieldMain";

export const metadata: Metadata = {
  description: "Preserve and diagnose exact Legacy Capture versions in encrypted quarantine.",
  title: "Legacy import — Diagnostics and Recovery | Ask Siargao",
};

export default function LegacyImportPage() {
  const harness =
    process.env.NODE_ENV !== "production" && process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS === "1";
  return (
    <FieldMain>
      <LegacyImportDiagnostics harness={harness} />
    </FieldMain>
  );
}
