import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AuditStatusPage } from "@/features/audit-status/AuditStatusPage";

describe("AuditStatusPage", () => {
  test("starts its heading outline with the status page heading", () => {
    const html = renderToStaticMarkup(
      <AuditStatusPage auditRequestId="audit_123" state="awaiting_payment" />,
    );

    const firstHeadingIndex = html.search(/<h[1-6]/);
    const pageHeadingIndex = html.indexOf("<h1");

    expect(pageHeadingIndex).toBeGreaterThan(-1);
    expect(firstHeadingIndex).toBe(pageHeadingIndex);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Audit audit_123");
    expect(html).toContain("Waiting for Stripe confirmation");
  });
});
