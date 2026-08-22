import type { Metadata } from "next";

import { FieldDayPlanner } from "@/features/field-planning/FieldDayPlanner";
import {
  createFailClosedPlannerFixture,
  createPlannerFixture,
} from "@/features/field-planning/fixtures/planner-fixtures";
import { loadPlannerProtocol } from "@/features/field-planning/load-planner-protocol";

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
    <FieldDayPlanner
      protocol={protocol}
      coverageSnapshot={fixture.coverageSnapshot}
      initialInputs={fixture.inputs}
    />
  );
}
