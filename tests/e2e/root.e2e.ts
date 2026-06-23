import { expect, test } from "@playwright/test";

test("renders the scaffold landing shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /find the trip risks/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /start audit/i })).toBeVisible();
  await expect(page.getByLabel("Audit preview")).toContainText("Quality gates are online");
});
