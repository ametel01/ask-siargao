# Landing Page Style Requirements

This document extracts the visual and CSS requirements from `landing.png` for the Siargao Portal Trip Risk Audit landing page.

The screenshot is 948px wide by 1659px tall. It shows a full landing page with a dark coastal background, purple/violet brand system, white glass panels, evidence/report UI cards, and green/yellow risk semantics.

## Visual Direction

The page should feel like a premium travel-risk decision tool, not a generic SaaS landing page.

Design qualities:

- Trustworthy and evidence-led.
- Coastal and destination-specific.
- Dark cinematic hero atmosphere.
- Clean white analytical panels.
- Purple/violet brand accents.
- Green/yellow status colors for risk scoring.
- Rounded, card-based report UI with soft shadows.
- Mobile-first interactions, but desktop layout should feel complete and polished.

Avoid:

- Generic flat SaaS sections.
- Abstract gradient-only backgrounds.
- Decorative blobs/orbs unrelated to Siargao.
- Uncited claims presented as marketing copy.
- Excessive animation or playful motion.

## Page Background

The full page uses a Siargao sunset/beach image as a persistent atmospheric background.

Requirements:

- Use a real or generated coastal Siargao-style bitmap image.
- Image should include ocean, sunset/purple sky, and palm silhouettes.
- Background should remain visible between and behind sections.
- Apply a dark navy overlay so white text and panels remain readable.
- Add a subtle violet tint overlay to unify the page.
- Avoid heavy blur; the place should remain recognizable.

Suggested CSS:

```css
body {
  min-height: 100vh;
  color: var(--text-on-dark);
  background:
    linear-gradient(
      180deg,
      rgba(6, 10, 48, 0.92) 0%,
      rgba(22, 15, 76, 0.82) 42%,
      rgba(10, 14, 54, 0.94) 100%
    ),
    url("/images/siargao-sunset.jpg") center top / cover fixed no-repeat;
}
```

On mobile, avoid `background-attachment: fixed` if it causes jank.

## Design Tokens

Use centralized tokens through Panda CSS tokens and recipes. These values are extracted/approximated from the screenshot and should be used as the first implementation baseline.

### Color Tokens

```css
:root {
  --color-navy-980: #05082a;
  --color-navy-950: #090d3a;
  --color-navy-900: #10124a;
  --color-navy-850: #17105a;
  --color-navy-800: #20186b;

  --color-violet-700: #4c31b8;
  --color-violet-650: #5d3ed1;
  --color-violet-600: #6c46e8;
  --color-violet-550: #7a51f0;
  --color-violet-500: #875cf6;
  --color-violet-400: #a486ff;

  --color-lavender-100: #f5f3ff;
  --color-lavender-150: #eeeafd;
  --color-lavender-200: #e2dcf7;
  --color-lavender-300: #cbc3ec;

  --color-surface: #ffffff;
  --color-surface-soft: #fbfaff;
  --color-surface-tint: #f7f5ff;
  --color-surface-glass: rgba(255, 255, 255, 0.94);

  --color-text-strong: #0d104a;
  --color-text: #17184f;
  --color-text-muted: #5f5f87;
  --color-text-soft: #8483a8;
  --color-text-on-dark: #ffffff;
  --color-text-on-dark-muted: #d8d5f4;

  --color-border: #ddd8ef;
  --color-border-strong: #c8bee9;
  --color-border-on-dark: rgba(255, 255, 255, 0.34);

  --color-risk-low: #60aa60;
  --color-risk-low-dark: #2e8a38;
  --color-risk-medium: #e6a928;
  --color-risk-high: #d84b55;

  --color-shadow: rgba(14, 12, 56, 0.16);
  --color-shadow-strong: rgba(8, 8, 38, 0.32);
}
```

### Gradient Tokens

```css
:root {
  --gradient-hero-overlay:
    linear-gradient(90deg, rgba(5, 8, 42, 0.96) 0%, rgba(16, 18, 74, 0.72) 46%, rgba(93, 62, 209, 0.22) 100%);

  --gradient-cta:
    linear-gradient(135deg, #875cf6 0%, #6c46e8 52%, #5d3ed1 100%);

  --gradient-price-card:
    linear-gradient(145deg, #271776 0%, #17105a 56%, #0c103f 100%);

  --gradient-panel:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 246, 255, 0.96) 100%);
}
```

### Typography Tokens

The screenshot uses a geometric sans look. Use a readable production font with compact proportions.

Recommended stack:

```css
:root {
  --font-sans: "Manrope", "Inter", "Avenir Next", system-ui, sans-serif;
}
```

If avoiding Inter as a primary brand face, use Manrope or Plus Jakarta Sans first.

Scale:

```css
:root {
  --text-2xs: 0.6875rem; /* 11px */
  --text-xs: 0.75rem;    /* 12px */
  --text-sm: 0.875rem;   /* 14px */
  --text-md: 1rem;       /* 16px */
  --text-lg: 1.125rem;   /* 18px */
  --text-xl: 1.375rem;   /* 22px */
  --text-2xl: 1.75rem;   /* 28px */
  --text-3xl: 2.5rem;    /* 40px */
  --text-4xl: 3rem;      /* 48px */
}
```

Hero desktop:

- H1: 48px, 1.08 line height, 700-800 weight.
- Body: 17-18px, 1.55 line height.
- CTA: 16px, 700 weight.
- Badge: 13px, 600 weight.

Section desktop:

- Section title: 22-24px, 700-800 weight.
- Card title: 13-15px, 700 weight.
- Card body: 12-13px, 500 weight.

Mobile:

- H1: 34-38px.
- Section title: 20-22px.
- Body: 15-16px.
- Avoid viewport-width font scaling.

Letter spacing:

- Default letter spacing should be `0`.
- Logo text may use `0.02em`.
- Do not use negative letter spacing.

## Spacing And Layout Tokens

Use a 4px base scale.

```css
:root {
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
}
```

Page layout:

- Outer page padding desktop: 18-20px.
- Content max width in screenshot: nearly full width with 12-20px gutters.
- Recommended production max width: 1180-1240px.
- Section vertical gap: 12-16px.
- Card internal padding: 20-28px for large panels, 16-20px for small cards.
- Dense report cards: 12-16px padding.

## Radius, Border, And Shadow Tokens

The screenshot uses rounded cards with soft borders. Keep radius controlled and consistent.

```css
:root {
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 12px;
  --radius-pill: 999px;

  --shadow-card: 0 14px 36px rgba(14, 12, 56, 0.12);
  --shadow-card-strong: 0 22px 54px rgba(8, 8, 38, 0.28);
  --shadow-cta: 0 10px 24px rgba(108, 70, 232, 0.35);
}
```

Requirement:

- Default cards should use `8px` radius.
- Larger marketing/report panels may use `10-12px` only when matching the screenshot.
- Borders should be visible but soft: `1px solid var(--color-border)`.
- White panels should have a subtle shadow, not a heavy floating effect.

## Header

Desktop header layout:

- Height: 64-72px.
- Left: logo lockup.
- Center/right: navigation links.
- Far right: primary CTA button.
- Header content aligns to page gutters.
- Header overlays the hero background, no solid white bar.

Logo:

- White mark and text.
- Mark approximately 36-42px.
- Text lockup: brand line plus small subtitle.
- Brand text uppercase or small caps.

Navigation:

- Font size: 13px.
- Weight: 600.
- Color: white with 80-90% opacity.
- Hover: white plus subtle underline or opacity increase.
- Gap: 36-48px on desktop.

CTA:

- Purple gradient.
- 44px height.
- 8px radius.
- Padding: 18-22px horizontal.
- White bold text.
- Shadow: violet glow.

Mobile:

- Keep logo and CTA visible.
- Collapse nav into menu or omit secondary nav.
- Header height: 60-64px.

## Hero Section

Desktop hero:

- Two-column layout.
- Left content width: about 55-60%.
- Right report preview card width: about 280-330px in screenshot, 360-420px at larger desktop widths.
- Top hero area height: about 300-360px in screenshot.
- Align hero card vertically center to text block.

Hero text content:

- Pill badge above headline.
- H1 split across two lines.
- Supporting copy below.
- CTA row with primary button and price.
- Two checkmark notes below CTA row.

Badge:

```css
.badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--color-border-on-dark);
  border-radius: var(--radius-pill);
  color: var(--color-text-on-dark);
  background: rgba(10, 13, 58, 0.34);
  backdrop-filter: blur(10px);
}
```

Hero CTA:

- Width in screenshot: about 200px.
- Height: 48px.
- Radius: 6-8px.
- Gradient violet.
- White text.
- Adjacent price: `USD 9.99`, 20px, white.

Check notes:

- White check icon.
- 13-14px text.
- Vertical gap: 8px.

Mobile hero:

- Single column.
- H1 first, report card second or hidden until after CTA.
- CTA and price stack or wrap cleanly.
- Avoid text overlaying the report preview.

## Trip Risk Preview Card

White floating card in the hero.

Requirements:

- Background: `var(--color-surface-glass)`.
- Radius: 14-16px in screenshot; use 12px max unless component system allows larger hero card.
- Width: 300-420px depending on viewport.
- Padding: 20-24px.
- Shadow: strong but soft.
- Header row with title and small "Sample" pill.
- Large semicircle gauge.
- Right-side rating copy.
- Risk list with row dividers.
- Outline secondary button at bottom.

Risk gauge:

- Semicircle/arc style.
- Low risk uses green.
- Inactive arc uses pale gray.
- Center text uppercase: `LOW RISK`.
- Gauge label font: 18-22px, 700 weight.

Risk rows:

- Dot status icon.
- Label left.
- Status right.
- Row height: 30-34px.
- Border-top or border-bottom in pale lavender/gray.

Secondary outline button:

- Height: 42px.
- Border: violet.
- Text: violet.
- Radius: 6-8px.
- Full width.

## "What We Check" Section

White full-width panel under hero.

Requirements:

- Surface: white or very light lavender.
- Radius: 10-12px.
- Padding: 20-24px.
- Title top-left.
- Six cards in a single row on desktop.
- Cards have icon, title, and 1-2 line description.

Card:

- Border: `1px solid var(--color-border)`.
- Radius: 8px.
- Padding: 16px.
- Min height: 74-86px.
- Icon: violet line icon, 24-28px.
- Title: 12-13px bold.
- Description: 11-12px muted.

Mobile:

- 2-column grid for cards.
- 1-column below narrow widths.
- Preserve fixed card min-height to avoid layout shift.

## "How It Works" Section

White panel with process cards and a media card.

Desktop:

- Section title centered.
- Four process cards in a row.
- Arrows between cards.
- Video/visual card on right.
- Process cards are compact and vertically oriented.

Process card:

- Border card with 8px radius.
- Top numbered dot overlapping the card top edge.
- Large violet icon.
- Title.
- Short body copy.

Number dot:

- 22-24px circle.
- Violet fill.
- White number.
- Position absolute at top center.

Arrow:

- Light lavender-gray.
- Simple arrow icon.
- Horizontally centered between cards.

Media card:

- Background image with beach/palm.
- Dark overlay.
- Text top-left.
- Play button centered.
- Radius: 8px.
- Aspect ratio about 16:9.

Mobile:

- Process cards stack or become 2-column.
- Remove arrows or rotate them only if it remains clean.
- Media card below process steps.

## Trust Band

Section with beach/surfer image on the left and trust cards on the right.

Requirements:

- White panel with horizontal image strip.
- Left image occupies roughly 20-25% width.
- Overlay or crop should keep surfer silhouette visible.
- Section title centered above cards.
- Four trust cards in a row.

Trust cards:

- White or translucent surface.
- Border: pale lavender.
- Violet icons.
- Title bold.
- Body muted and concise.

Mobile:

- Stack title and cards.
- Image can become a top banner or hidden if it hurts readability.

## Sample Report Section

This is the most product-specific part of the page and should look like a real report preview.

Desktop:

- Large white panel.
- Left column: feature list plus outline CTA.
- Right column: report preview screenshot/card.
- Report preview uses nested cards, but must remain readable and not overcrowded.

Left feature list:

- Violet icons.
- Bold label.
- Muted explanatory line.
- Vertical gap: 18-22px.
- CTA outline button at bottom.

Report preview card:

- Width: about 560px in screenshot.
- Surface: white.
- Radius: 12px.
- Border and shadow.
- Header with report title and sample pill.
- Grid of cards: overall rating, category breakdown, recommendations.
- Evidence snapshot row.
- Footer row with "What We Couldn't Verify" and generated timestamp.

Nested report cards:

- Use `8px` radius.
- Fine borders.
- Tiny labels and compact rows.
- Green/yellow status labels.
- Keep all text legible at desktop.

Mobile:

- Stack feature list and report preview.
- Report preview may become horizontally scrollable only if necessary, but prefer responsive reflow.
- Do not shrink text below 11px.

## Testimonials

White panel over the beach background.

Requirements:

- Centered title.
- Three testimonial cards desktop.
- Quote mark icon in violet.
- Short quote.
- Avatar/name/location row.
- Pagination dots below cards.

Card:

- White surface.
- Border.
- Radius: 8px.
- Padding: 20px.
- Min height: 120px.

Pagination:

- Active dot violet.
- Inactive dots pale lavender.

Mobile:

- Carousel or stacked cards.
- Keep avatar row aligned and avoid overflow.

## Pricing And FAQ Section

Two-column section near bottom.

Left: dark price card.

- Deep navy/violet gradient.
- White border or lavender border.
- Radius: 10-12px.
- Header chip: "One simple price".
- Large price: `USD 9.99`.
- Subtext: per trip risk audit.
- Checklist with white checks.
- Full-width violet CTA.

Right: FAQ card.

- White surface.
- Centered title.
- Accordion rows.
- Row height: 40-46px.
- Border between rows.
- Chevron icon right.
- Text 12-13px.

Mobile:

- Stack price card above FAQ.
- FAQ rows should remain tappable with at least 44px height.

## Footer

Dark navy footer over background.

Requirements:

- Solid or nearly solid navy overlay.
- Logo and short description left.
- Social icons row.
- Link columns: Product, Company, Legal.
- Newsletter signup right.
- Bottom copyright and "Made with care in Siargao" line.

Footer tokens:

- Background: `rgba(5, 8, 42, 0.94)` or `var(--color-navy-980)`.
- Text: white and lavender-muted.
- Column separators: subtle vertical borders.
- Input background: translucent lavender.
- Subscribe button: violet gradient.

Mobile:

- Stack columns.
- Newsletter full width.
- Footer links in 2-column grid.

## Buttons

Primary button:

```css
.buttonPrimary {
  min-height: 44px;
  padding: 0 22px;
  border: 0;
  border-radius: var(--radius-md);
  color: #fff;
  font-weight: 700;
  background: var(--gradient-cta);
  box-shadow: var(--shadow-cta);
}
```

Hover:

- Slightly brighter violet.
- Translate up by 1px.
- Increase shadow subtly.

Active:

- Translate back to 0.
- Reduce shadow.

Focus:

- Visible 2px focus ring using lavender or white depending on background.

Secondary outline:

```css
.buttonSecondary {
  min-height: 42px;
  padding: 0 20px;
  border: 1px solid var(--color-violet-600);
  border-radius: var(--radius-md);
  color: var(--color-violet-650);
  font-weight: 700;
  background: transparent;
}
```

## Icons

Use lucide icons where possible.

Icon style:

- Stroke width: 1.8-2.
- Color: violet.
- Size: 22-30px depending on card.
- Keep icon containers simple; no large colored circles unless needed.

Recommended icons:

- Logistics: `Truck`
- Weather: `CloudSun`
- Accommodation: `House`
- Internet: `Wifi`
- Health: `ShieldPlus`
- Rules/fees: `ClipboardCheck`
- Source/citations: `FileText`
- Freshness: `CalendarDays`
- Local sources: `Users`
- Confidence: `TrendingUp`
- Enter details: `FilePenLine`
- Verify sources: `Search`
- Score risk: `ShieldCheck`
- Report: `FileText`

## Forms

Newsletter input:

- Height: 40-44px.
- Background: rgba(255, 255, 255, 0.16).
- Border: rgba(255, 255, 255, 0.18).
- Text: white.
- Placeholder: lavender-muted.
- Radius: 6-8px.
- Inline subscribe button on desktop.
- Stacked input/button on small mobile.

Audit intake forms should reuse the same token system but can be denser and more functional than the landing page.

## Motion

Motion should be minimal and trust-preserving.

Allowed:

- CTA hover lift.
- Card hover border/shadow refinement.
- Accordion expand/collapse.
- Process step reveal on scroll.
- Report card subtle fade-in.

Avoid:

- Bouncy animations.
- Continuous floating cards.
- Over-animated gauges.
- Parallax that makes text hard to read.

Timing:

```css
:root {
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --duration-fast: 140ms;
  --duration-normal: 220ms;
  --duration-slow: 360ms;
}
```

Respect `prefers-reduced-motion`.

## Accessibility Requirements

- Text over image backgrounds must meet WCAG contrast.
- Do not place small text directly on busy image areas without overlay.
- Buttons and FAQ rows must have at least 44px touch target height.
- Use semantic headings in order.
- Risk states must not rely on color alone; include text labels.
- Gauge must have accessible text alternative.
- Video preview must have a real button label.
- Form input must have accessible label.
- Focus states must be visible on dark and light surfaces.

## Responsive Breakpoints

Suggested breakpoints:

```css
:root {
  --breakpoint-sm: 480px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
}
```

Behavior:

- `< 480px`: single-column, compressed hero, full-width buttons.
- `480-767px`: 2-column mini-card grids where possible.
- `768-1023px`: tablet layout; hero may stay 2-column if report card fits.
- `>= 1024px`: full desktop layout.
- `>= 1280px`: max-width container, larger hero report card, more breathing room.

## shadcn And Panda CSS Implementation Notes

Use shadcn/ui for accessible component blueprints and interaction patterns, then restyle the generated local code with Panda CSS.

Requirements:

- shadcn-derived components must be committed as local source, not treated as an external black-box theme.
- Replace Tailwind utility classes with Panda recipes, `css` calls, or slot recipes.
- Keep Radix-powered accessibility behavior from shadcn components where relevant.
- Do not import Tailwind global styles or use Tailwind as the production styling system.
- Use shadcn components for accordions, dialogs, sheets, tabs, menus, popovers, tooltips, forms, inputs, buttons, badges, cards, tables, skeletons, and toasts.
- Landing-specific components should compose shadcn-derived primitives with Siargao Portal recipes.

Recommended mapping:

| Landing element | shadcn base | Panda/custom layer |
| --- | --- | --- |
| Header CTA and hero CTA | `Button` | `button` recipe with violet gradient |
| Hero badge and sample pill | `Badge` | `badge` recipe with dark/glass variants |
| Trip risk preview | `Card` | `riskPreviewCard` recipe plus custom gauge |
| What we check cards | `Card` | `miniFeatureCard` recipe |
| How it works process cards | `Card` | `processCard` recipe |
| FAQ | `Accordion` | `faqAccordion` recipe |
| Pricing panel | `Card` | `pricingCard` recipe |
| Footer newsletter input | `Input` and `Button` | `newsletterForm` recipe |
| Report evidence table | `Table` | `reportEvidenceTable` recipe |
| Mobile nav | `Sheet` | `mobileNav` recipe |
| Tooltips | `Tooltip` | shared tooltip recipe |

The visual source of truth remains this document plus Panda tokens. shadcn should provide proven markup, accessibility, and component structure.

Recommended token groups:

- `colors.navy`
- `colors.violet`
- `colors.lavender`
- `colors.surface`
- `colors.text`
- `colors.risk`
- `radii`
- `shadows`
- `spacing`
- `fontSizes`
- `fontWeights`

Recommended recipes:

- `pageShell`
- `header`
- `button`
- `sectionPanel`
- `miniFeatureCard`
- `processCard`
- `trustCard`
- `riskPreviewCard`
- `riskGauge`
- `reportPreview`
- `testimonialCard`
- `pricingCard`
- `faqAccordion`
- `footer`

Avoid page-local style sprawl. The screenshot repeats cards, borders, icon treatments, and purple buttons; these should be recipes/components, not one-off CSS.

## QA Checklist

- Hero text is readable on the image at desktop and mobile.
- Report preview does not overflow on mobile.
- All cards have consistent border, radius, and shadow treatment.
- Purple CTA color is consistent across header, hero, pricing, and footer.
- Green/yellow risk labels are readable and text-labeled.
- Section panels align to a shared container.
- No text overlaps image focal points.
- No button text wraps awkwardly.
- Footer newsletter input fits on narrow screens.
- `prefers-reduced-motion` disables nonessential motion.
- Page still works if the background image fails to load.
