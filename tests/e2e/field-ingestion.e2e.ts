import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const protectedUiHarnessHeader = {
  "x-ask-siargao-protected-ui-harness": "1",
  "x-ask-siargao-protected-ui-harness-token":
    "ask-siargao-playwright-protected-ui-harness-token-2026",
};
const visitId = "0192f060-4f41-7aa1-b322-4aa9fc9f15f0";
const clientBatchId = "0192f060-4f41-7aa1-b322-4aa9fc9f15f1";
const records = [
  {
    schemaVersion: "field-record.v1",
    recordType: "visit",
    id: visitId,
    clientBatchId,
    campaignSlug: "island-baseline-2026",
    capturedAt: "2026-08-22T09:30:00+08:00",
    localTimezone: "Asia/Manila",
    observerKey: "playwright-researcher",
    areaId: "legacy_del_carmen",
    purposeCodes: ["guide_fact_check"],
    startedAt: "2026-08-22T09:30:00+08:00",
  },
  {
    schemaVersion: "field-record.v1",
    recordType: "observation",
    id: "0192f060-4f41-7aa1-b322-4aa9fc9f15f2",
    clientBatchId,
    campaignSlug: "island-baseline-2026",
    capturedAt: "2026-08-22T09:32:00+08:00",
    localTimezone: "Asia/Manila",
    visitId,
    observationKind: "opening_hours",
    directness: "direct_observation",
    observedAt: "2026-08-22T09:32:00+08:00",
    value: { state: "open", basis: "observed", postedHoursSeparatelyEvidenced: false },
    method: "structured_visual_check",
    conditionTags: ["weather_cloudy", "road_dry"],
    fieldConfidence: "high",
    reviewDueAt: "2026-08-29T09:32:00+08:00",
    status: "captured",
    llmUseAllowed: false,
    articleUseAllowed: false,
    publicRepublishAllowed: false,
    omittedHistoricalNote: "preserve without display",
  },
  {
    schemaVersion: "field-record.v1",
    recordType: "observation",
    id: "0192f060-4f41-7aa1-b322-4aa9fc9f15f3",
    clientBatchId,
    campaignSlug: "island-baseline-2026",
    capturedAt: "2026-08-22T09:34:00+08:00",
    localTimezone: "Asia/Manila",
    visitId,
    observationKind: "opening_hours",
    directness: "direct_observation",
    observedAt: "2026-08-22T09:34:00+08:00",
    value: { state: "open", basis: "observed", postedHoursSeparatelyEvidenced: false },
    method: "structured_visual_check",
    conditionTags: [],
    fieldConfidence: "high",
    reviewDueAt: "2026-08-29T09:34:00+08:00",
    status: "captured",
    llmUseAllowed: true,
    articleUseAllowed: false,
    publicRepublishAllowed: false,
  },
];

test("redirects the old alias into exceptional encrypted Legacy Capture quarantine", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders(protectedUiHarnessHeader);
  const response = await page.goto("/admin/field-ingestion");
  const redirectResponse = await response?.request().redirectedFrom()?.response();

  expect(redirectResponse?.status()).toBe(307);
  await expect(page).toHaveURL(/\/operator\/field\/diagnostics-recovery\/legacy-import$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Legacy import — Diagnostics and Recovery" }),
  ).toBeVisible();
  await expect(page.getByText("Authorized Field Device unlocked")).toBeVisible();
  await expect(page.getByText("No promotion")).toBeVisible();
  await expect(
    page.getByText("No server upload, PostgreSQL write", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("local admin token", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Island field desk", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Validated batch", { exact: false })).toHaveCount(0);

  await page.getByTestId("legacy-capture-file-input").setInputFiles({
    name: "legacy-field-records.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(records)),
  });
  await expect(
    page.getByText("Original bytes and the non-mutating preview", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quarantined corpus report" })).toBeVisible();
  await expect(
    page.getByText("opening_hours → observationKind: opening_signal", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Legacy property omittedHistoricalNote", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Historical permission claims cannot grant current use.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Schema Gap candidates" }).first()).toBeVisible();
  await expect(page.getByText("never Ready", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Preserve quarantined decision" }).click();
  await expect(page.getByText("Append-only decision recorded", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ready for Desk/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Ready for Export/u })).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("keeps JSON import outside every ordinary Field Workspace area", async ({ page }) => {
  await page.setExtraHTTPHeaders(protectedUiHarnessHeader);
  for (const path of ["plan", "capture", "review", "exports"]) {
    await page.goto(`/operator/field/${path}`);
    const ordinaryNavigation = page.getByRole("navigation", {
      name: "Field Workspace ordinary areas",
    });
    await expect(ordinaryNavigation).toBeVisible();
    await expect(ordinaryNavigation.getByText("Legacy import", { exact: false })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByText("JSONL", { exact: false })).toHaveCount(0);
    await expect(page.getByText("capture template", { exact: false })).toHaveCount(0);
  }
  const exceptionalNavigation = page.getByRole("navigation", { name: "Diagnostics and Recovery" });
  await expect(exceptionalNavigation).toBeVisible();
  await exceptionalNavigation.getByRole("link", { name: "Diagnostics and Recovery" }).focus();
  await expect(
    exceptionalNavigation.getByRole("link", { name: "Diagnostics and Recovery" }),
  ).toBeFocused();
});
