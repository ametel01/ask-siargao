import type { Metadata } from "next";
import { FieldExports } from "@/features/field-exports/FieldExports";

export const metadata: Metadata = {
  title: "Protected Field Exports | Ask Siargao",
  description: "Create distinct Recovery and reviewed Field Batch artifacts.",
};

export default function FieldExportsPage() {
  const harness =
    process.env.NODE_ENV !== "production" && process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS === "1";
  return <FieldExports harness={harness} />;
}
