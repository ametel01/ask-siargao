import { expect, test } from "@playwright/test";

test("renders the desktop Ask Siargao chat workspace", async ({ page }) => {
  await page.goto("/chat");

  await expect(page.getByLabel("Ask Siargao chat workspace")).toBeVisible();
  await expect(page.getByRole("link", { name: /new question/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask Siargao" })).toBeVisible();
  await expect(page.getByText("Local travel assistant")).toBeVisible();
  await expect(page.getByText("Is this accommodation near Cloud 9 quiet at night?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trip context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cloud 9 Weather" })).toBeVisible();
  await expect(page.getByLabel("Ask anything about your Siargao trip")).toBeVisible();
});

test("renders the mobile Ask Siargao chat layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");

  await expect(page.getByLabel("Ask Siargao mobile chat")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask Siargao" })).toBeVisible();
  await expect(page.getByText("Cloud 9 area")).toBeVisible();
  await expect(page.getByText("24 live refreshes left")).toBeVisible();
  await expect(page.getByText(/Will my place be quiet/i)).toBeVisible();
  await expect(page.getByLabel("Ask Ask Siargao on mobile")).toBeVisible();
});
