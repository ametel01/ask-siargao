import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const harnessHeaders = {
  "x-ask-siargao-protected-ui-harness": "1",
  "x-ask-siargao-protected-ui-harness-token":
    "ask-siargao-playwright-protected-ui-harness-token-2026",
};

test("records every append-only Desk decision without exposing a JSON workbench", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders(harnessHeaders);
  await page.goto("/operator/field/review");
  await expect(page.getByRole("heading", { level: 1, name: "Field review" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Assignment queue" })).toContainText(
    "Objective coverage",
  );
  for (const decision of ["Include", "Exclude", "Needs more evidence", "Correct by supersession"]) {
    await page.getByLabel(decision, { exact: false }).check();
    if (decision === "Exclude" || decision === "Needs more evidence") {
      await page.getByLabel("Review reason").fill("Focused browser decision evidence.");
    }
    if (decision === "Correct by supersession") {
      await page.getByLabel("Corrected observation value").fill("Controlled successor value");
    }
    const submit = page.getByRole("button", { name: "Record append-only decision" });
    await submit.focus();
    await submit.press("Enter");
  }
  await expect(page.getByRole("heading", { name: "Review history" })).toBeVisible();
  await expect(page.getByText("Linked Follow-up Assignment")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Typed successor" })).toBeVisible();
  await expect(page.getByText("Focused browser decision evidence.")).toHaveCount(2);
  await expect(page.getByText("JSON", { exact: false })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("keeps Recovery and reviewed Batch labels, actions and receipts distinct", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders(harnessHeaders);
  await page.goto("/operator/field/exports");
  await expect(page.getByRole("heading", { name: "Field Recovery Export" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Field Batch" })).toBeVisible();
  await page.getByRole("button", { name: "Create Recovery Export" }).click();
  await expect(page.getByText("Created and locally re-opened")).toBeVisible();
  await page.getByRole("button", { name: "Create reviewed Field Batch" }).click();
  await expect(page.getByText("Created from the eligible graph")).toBeVisible();
  await page.getByRole("button", { name: "Restore Recovery Export" }).click();
  await expect(page.getByText("Restore preview ready")).toBeVisible();
  await page.getByRole("button", { name: "Verify Field Batch" }).click();
  await expect(page.getByText("Recipient verification started")).toBeVisible();
  await expect(page.getByText("JSON", { exact: false })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});
