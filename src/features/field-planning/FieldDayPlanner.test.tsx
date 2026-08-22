import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FieldDayPlanner } from "./FieldDayPlanner";
import { createTestPlannerFixture } from "./fixtures/test-fixtures";

describe("FieldDayPlanner", () => {
  test("renders labelled planning controls and textual explanations", () => {
    const fixture = createTestPlannerFixture();
    const html = renderToStaticMarkup(
      <FieldDayPlanner
        protocol={fixture.protocol}
        coverageSnapshot={fixture.coverageSnapshot}
        initialInputs={fixture.inputs}
      />,
    );

    expect(html).toContain("Build a Field Day Plan");
    expect(html).toContain("Offline package ready");
    expect(html).toContain("Starting area");
    expect(html).toContain("Transport mode");
    expect(html).toContain("Selected Field Assignments");
    expect(html).toContain("Coverage consequence:");
    expect(html).toContain('role="status"');
    expect(html).toContain("No map, live routing, date assignment, or LLM is used.");
  });
});
