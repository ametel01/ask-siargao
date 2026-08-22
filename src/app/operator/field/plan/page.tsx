import type { Metadata } from "next";
import {
  createFailClosedPlannerFixture,
  createPlannerFixture,
} from "@/features/field-planning/fixtures/planner-fixtures";
import { loadPlannerProtocol } from "@/features/field-planning/load-planner-protocol";
import { FieldPlanRecorderBridge } from "@/features/field-recorder/FieldPlanRecorderBridge";

export const metadata: Metadata = {
  title: "Build a Field Day Plan | Ask Siargao",
  description: "Prepare an unscheduled, deterministic, capacity-bounded field research outing.",
};

export default async function FieldDayPlanPage() {
  const protocol = await loadPlannerProtocol();
  const fixture =
    process.env.NODE_ENV !== "production" && process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS === "1"
      ? createPlannerFixture(protocol)
      : createFailClosedPlannerFixture(protocol);
  return (
    <FieldPlanRecorderBridge
      applicationVersion="0.1.0"
      coverageSnapshot={fixture.coverageSnapshot}
      initialInputs={fixture.inputs}
      protocol={protocol}
    />
  );
}
