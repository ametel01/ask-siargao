import type { Metadata } from "next";

import { FieldRecorderShell } from "@/features/field-recorder/FieldRecorderShell";
import { loadRecorderProtocol } from "@/features/field-recorder/load-recorder-protocol";

export const metadata: Metadata = {
  description: "Capture typed, governed field evidence in the protected offline workspace.",
  title: "Field Recorder | Ask Siargao",
};

export default async function FieldRecorderPage() {
  const protocol = await loadRecorderProtocol();
  const harness =
    process.env.NODE_ENV !== "production" && process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS === "1";
  return <FieldRecorderShell harness={harness} protocol={protocol} />;
}
