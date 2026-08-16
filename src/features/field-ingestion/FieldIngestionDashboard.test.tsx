import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FieldIngestionDashboard } from "@/features/field-ingestion/FieldIngestionDashboard";

describe("FieldIngestionDashboard", () => {
  test("renders the local-only import, review, and export boundary", () => {
    const html = renderToStaticMarkup(<FieldIngestionDashboard accessMode="local" />);

    expect(html).toContain("Island field desk");
    expect(html).toContain("Bring in iPad exports");
    expect(html).toContain("Local review queue");
    expect(html).toContain("Export validated batch");
    expect(html).toContain("sent to PostHog or PostgreSQL");
    expect(html).toContain("A dashboard export is a validated staging envelope");
    expect(html).not.toContain("Upload to production");
  });
});
