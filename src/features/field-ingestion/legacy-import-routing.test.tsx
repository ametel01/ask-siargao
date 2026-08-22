import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FieldSecuritySessionProvider } from "@/features/field-security/FieldSecuritySessionProvider";
import { LegacyImportDiagnostics } from "./LegacyImportDiagnostics";
import { canonicalLegacyImportRoute, legacyImportAliasMode } from "./legacy-import-routing";

describe("Legacy import route promotion and rollback", () => {
  test("defaults invalid or missing configuration to the canonical temporary redirect", () => {
    expect(canonicalLegacyImportRoute).toBe("/operator/field/diagnostics-recovery/legacy-import");
    expect(legacyImportAliasMode(undefined)).toBe("redirect");
    expect(legacyImportAliasMode("redirect")).toBe("redirect");
    expect(legacyImportAliasMode("invalid")).toBe("redirect");
    expect(legacyImportAliasMode("fallback")).toBe("fallback");
  });

  test("rollback renders the same exceptional device-locked workflow without old capabilities", () => {
    const html = renderToStaticMarkup(
      <FieldSecuritySessionProvider>
        <LegacyImportDiagnostics rollbackAlias />
      </FieldSecuritySessionProvider>,
    );
    expect(html).toContain("Legacy import — Diagnostics and Recovery");
    expect(html).toContain("Recovery fallback is active");
    expect(html).toContain("Protected data locked");
    expect(html).not.toContain("local admin token");
    expect(html).not.toContain("Island field desk");
    expect(html).not.toContain("Validated batch");
    expect(html).not.toContain("Delete");
    expect(html).not.toContain("Clear workspace");
  });
});
