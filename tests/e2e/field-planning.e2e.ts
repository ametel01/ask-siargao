import { expect, test } from "@playwright/test";

test("generates and safely adjusts an accessible offline Field Day Plan", async ({
  context,
  page,
}) => {
  await page.setExtraHTTPHeaders({
    "x-ask-siargao-protected-ui-harness": "1",
    "x-ask-siargao-protected-ui-harness-token":
      "ask-siargao-playwright-protected-ui-harness-token-2026",
  });
  await page.goto("/operator/field/plan");

  await expect(
    page.getByRole("heading", { level: 1, name: "Build a Field Day Plan" }),
  ).toBeVisible();
  await expect(page.getByLabel("Starting area")).toBeVisible();
  await expect(page.getByLabel("Transport mode")).toBeVisible();
  await expect(page.getByRole("list", { name: "Selected Field Assignments" })).toBeVisible();
  await expect(page.getByText("Coverage consequence:").first()).toBeVisible();
  await expect(page.locator("[data-field-planner-ready]")).toHaveAttribute(
    "data-field-planner-ready",
    "true",
  );

  await context.setOffline(true);
  await page.getByRole("button", { name: "Generate deterministic proposal" }).click();
  await expect(page.getByRole("status")).toContainText("Proposal regenerated");

  const moveLater = page.getByRole("button", { name: "Move Connectivity transect later" });
  await moveLater.focus();
  await moveLater.press("Enter");
  await expect(page.getByRole("status")).toContainText("move accepted");
  await expect(moveLater).toBeFocused();

  const unsafeAdd = page.getByRole("button", {
    name: "Add assignment_conflict_follow_up",
  });
  await unsafeAdd.focus();
  await unsafeAdd.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Adjustment rejected:" })).toContainText(
    "does not pass every hard gate",
  );
  await expect(unsafeAdd).toBeFocused();
});
