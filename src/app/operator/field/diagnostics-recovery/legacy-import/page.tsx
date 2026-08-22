import type { Metadata } from "next";

import { LegacyImportDiagnostics } from "@/features/field-ingestion/LegacyImportDiagnostics";

export const metadata: Metadata = {
  description: "Preserve and diagnose exact Legacy Capture versions in encrypted quarantine.",
  title: "Legacy import — Diagnostics and Recovery | Ask Siargao",
};

export default function LegacyImportPage() {
  const harness =
    process.env.NODE_ENV !== "production" && process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS === "1";
  return (
    <main id="main-content">
      <LegacyImportDiagnostics harness={harness} />
    </main>
  );
}
