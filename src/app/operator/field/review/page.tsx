import type { Metadata } from "next";
import { FieldDesk } from "@/features/field-desk/FieldDesk";

export const metadata: Metadata = {
  title: "Field Review | Ask Siargao",
  description: "Review immutable field evidence by Assignment.",
};

export default function FieldReviewPage() {
  const harness =
    process.env.NODE_ENV !== "production" && process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS === "1";
  return <FieldDesk harness={harness} />;
}
