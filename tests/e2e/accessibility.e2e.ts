import { expect, test } from "@playwright/test";

for (const route of [
  "/",
  "/chat",
  "/legal/privacy",
  "/legal/trip-pass",
  "/audits/demo/report",
  "/sign-in",
]) {
  test(`skips repeated content on ${route}`, async ({ page }) => {
    await page.goto(route);

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await skipLink.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });
}

for (const route of ["/sign-in", "/sign-up"]) {
  test(`keeps the ${route} fallback action usable across compact viewports`, async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(route);

      const backToChatLink = page.getByRole("link", { name: "Back to chat" });
      await expect(backToChatLink).toBeVisible();

      const box = await backToChatLink.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
    }
  });
}
