import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import { FieldSecuritySessionProvider } from "@/features/field-security/FieldSecuritySessionProvider";
import { FieldOfflineAreas } from "./FieldOfflineAreas";

describe("prepared offline Field Workspace areas", () => {
  test("includes a locked exceptional Legacy Capture recovery destination", () => {
    const html = renderToStaticMarkup(
      <FieldSecuritySessionProvider>
        <FieldOfflineAreas protocol={baselineFieldProtocolPackage} />
      </FieldSecuritySessionProvider>,
    );

    expect(html).toContain('id="offline-legacy-import"');
    expect(html).toContain("Offline Diagnostics and Recovery destination");
    expect(html).toContain("Legacy import — Diagnostics and Recovery");
    expect(html).toContain("Protected data locked");
    expect(html).not.toContain("local admin token");
  });
});
