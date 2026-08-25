import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { createFieldWorkspaceContentSecurityPolicy } from "./field-workspace-csp";

describe("Field Workspace Content Security Policy", () => {
  test("permits nonce-bound styles while rejecting React style attributes", () => {
    const policy = createFieldWorkspaceContentSecurityPolicy("field-nonce", "production");

    expect(policy).toContain("style-src 'self' 'nonce-field-nonce'");
    expect(policy).toContain("style-src-attr 'none'");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  test("keeps Field Workspace React surfaces free of blocked style attributes", () => {
    const featuresRoot = join(process.cwd(), "src/features");
    const violations = readdirSync(featuresRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("field-"))
      .flatMap((entry) => collectTsxFiles(join(featuresRoot, entry.name)))
      .filter((file) => readFileSync(file, "utf8").includes("style={"))
      .map((file) => relative(process.cwd(), file));

    expect(violations).toEqual([]);
  });
});

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}
