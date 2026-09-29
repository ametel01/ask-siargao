import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlannerProtocol } from "@/features/field-planning/field-planning-types";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import { FieldSecuritySessionProvider } from "@/features/field-security/FieldSecuritySessionProvider";
import { FieldOfflineAreas } from "./FieldOfflineAreas";

describe("prepared offline Field Workspace areas", () => {
  test("advertises every locked offline Workspace area without identity", () => {
    const html = renderToStaticMarkup(
      <FieldSecuritySessionProvider>
        <FieldOfflineAreas
          plannerProtocol={baselineFieldProtocolPackage as unknown as PlannerProtocol}
          protocol={baselineFieldProtocolPackage}
        />
      </FieldSecuritySessionProvider>,
    );

    expect(html).toContain(
      'data-field-offline-areas="plan recorder review exports diagnostics-recovery"',
    );
    expect(html).toContain(">Plan</button>");
    expect(html).toContain(">Review</button>");
    expect(html).toContain(">Exports</button>");
    expect(html).toContain(">Open Diagnostics and Recovery</button>");
    expect(html).not.toContain("local admin token");
  });
});
