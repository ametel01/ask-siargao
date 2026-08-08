import { describe, expect, test } from "bun:test";

const css = await Bun.file(new URL("./global.css", import.meta.url)).text();

const customProperties = new Map(
  [...css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()]),
);

describe("theme foreground contrast", () => {
  test.each([
    ["high-confidence status", "--confidence-high-foreground", "--confidence-high-soft"],
    ["medium-confidence status", "--confidence-medium-foreground", "--confidence-medium-soft"],
    ["high-risk status", "--risk-high-foreground", "--risk-high-soft"],
    ["soft supporting text", "--text-soft", "--surface-default"],
    ["user message timestamp", "--text-on-dark", "--brand-lagoon-700"],
    ["Trip Pass CTA", "--trip-pass-cta-foreground", "--brand-lagoon-600"],
    ["Trip Pass CTA hover", "--trip-pass-cta-hover-foreground", "--brand-lagoon-700"],
  ])("keeps %s text at WCAG AA", (_label, foreground, background) => {
    expect(
      contrastRatio(resolveColor(foreground), resolveColor(background)),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("reduced motion policy", () => {
  test("does not globally suppress every animation and transition", () => {
    expect(css).not.toMatch(/\*::before[\s\S]*transition-duration:\s*0\.001ms/);
  });

  test("keeps targeted immediate alternatives for spatial and looping motion", () => {
    expect(css).toContain('[data-slot="button"]:active');
    expect(css).toContain("[data-sonner-toast][data-sonner-toast]");
    expect(css).toContain('[data-answer-arrival-motion="decision-strip-sequence"]');
  });
});

function resolveColor(property: string): string {
  const value = customProperties.get(property);
  if (!value) {
    throw new Error(`Missing theme property: ${property}`);
  }

  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  return reference ? resolveColor(reference) : value;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  if (!/^#[\da-f]{6}$/i.test(color)) {
    throw new Error(`Expected a six-digit hex color, received: ${color}`);
  }

  const [red, green, blue] = color
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    ) ?? [0, 0, 0];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
