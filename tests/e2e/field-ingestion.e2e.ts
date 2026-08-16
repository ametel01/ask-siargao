import { expect, test } from "@playwright/test";

const visitId = "0192f060-4f41-7aa1-b322-4aa9fc9f15f0";
const clientBatchId = "0192f060-4f41-7aa1-b322-4aa9fc9f15f1";
const protectedUiHarnessHeader = {
  "x-ask-siargao-protected-ui-harness": "1",
  "x-ask-siargao-protected-ui-harness-token":
    "ask-siargao-playwright-protected-ui-harness-token-2026",
};

const records = [
  {
    schemaVersion: "field-record.v1",
    recordType: "visit",
    id: visitId,
    clientBatchId,
    campaignSlug: "island-baseline-2026",
    capturedAt: "2026-08-22T09:30:00+08:00",
    localTimezone: "Asia/Manila",
    observerKey: "playwright-operator",
    provisionalSubjectName: "Playwright field site",
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
    observationKind: "opening_signal",
    directness: "direct_observation",
    observedAt: "2026-08-22T09:32:00+08:00",
    value: { openAtObservationInstant: true },
    method: "structured_visual_check",
    conditionTags: ["weekday"],
    fieldConfidence: "high",
    reviewDueAt: "2026-08-29T09:32:00+08:00",
    status: "captured",
    llmUseAllowed: false,
    articleUseAllowed: false,
    publicRepublishAllowed: false,
  },
];

test("field desk imports and exports a validated batch while the browser is offline", async ({
  context,
  page,
}) => {
  await page.setExtraHTTPHeaders(protectedUiHarnessHeader);
  await page.goto("/admin/field-ingestion");
  await expect(page.getByRole("heading", { name: "Island field desk" })).toBeVisible();
  await expect(page.getByText("Private browser storage ready")).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("Offline mode")).toBeVisible();

  await page.getByTestId("field-file-input").setInputFiles({
    name: "field-records.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(records)),
  });

  await expect(page.getByText("Import saved locally")).toBeVisible();
  await expect(page.getByTestId("field-record-list").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export validated batch" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`field-batch-${clientBatchId}.json`);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  expect(envelope.schemaVersion).toBe("field-batch.v1");
  expect(envelope.recordCounts).toMatchObject({ visit: 1, observation: 1 });
  expect(envelope.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(envelope.records).toHaveLength(2);
  await expect(page.getByText("Validated batch exported")).toBeVisible();
});
