import { expect, test } from "@playwright/test";

test("renders the scaffold landing shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /know if your siargao plan works/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /start trip audit/i })).toBeVisible();
  await expect(page.getByLabel("Trip risk preview card")).toContainText("LOW RISK");
  await expect(page.getByRole("heading", { name: "What we check" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A report that shows its work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();
});

test("FAQ rows are keyboard accessible", async ({ page }) => {
  await page.goto("/");

  const firstQuestion = page.getByText("When do I pay?");
  await firstQuestion.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText(/Only after the system verifies/i)).toBeVisible();
});

test("submits minimum viable intake and shows a preview risk", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Travel month").fill("2026-08");
  await page.getByLabel("Arrival origin").fill("Manila");
  await page.getByLabel("Accommodation name").fill("Example Surf Stay");
  await page.getByLabel("Planned stay area").selectOption("general-luna");
  await page.getByLabel("Top constraint").fill("quiet sleep");
  await page.getByLabel("Risk tolerance").selectOption("low_risk");
  await page.getByRole("button", { name: "Get preview risk" }).click();

  await expect(page.getByRole("heading", { name: "Preview risk ready" })).toBeVisible();
  await expect(page.getByText(/Arrival timing is the first thing to verify/i)).toBeVisible();
});

for (const width of [390, 768, 1024, 1366]) {
  test(`does not create horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}
