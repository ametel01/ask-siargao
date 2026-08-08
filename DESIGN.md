---
name: Ask Siargao
description: An island field desk that turns local evidence into calm, practical travel decisions.
colors:
  deep-island-night: "#05082a"
  deep-reef: "#062f35"
  storm-reef: "#102c38"
  lagoon-deep: "#0a6f67"
  lagoon-signal: "#14b8a6"
  lagoon-mist: "#ddfbf4"
  compass-violet: "#5d3ed1"
  pass-violet-night: "#271776"
  violet-mist: "#f5f3ff"
  shell-paper: "#fffdf7"
  warm-paper: "#fbf6e8"
  sand-paper: "#f5eddc"
  sunline-gold: "#ffd65a"
  sunset-coral: "#ff9b83"
  text-strong: "#0d104a"
  text-muted: "#5f5f87"
  text-soft: "#727197"
  text-on-night: "#fff9e9"
  text-on-night-muted: "#d8d5f4"
  border-soft: "#ddd8ef"
  risk-high: "#d84b55"
  confidence-high: "#1e9f63"
  confidence-medium: "#d99b23"
typography:
  display:
    fontFamily: "Cormorant Garamond, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "clamp(3rem, 6.1vw, 7.6rem)"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Cormorant Garamond, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 0.98
  operational-title:
    fontFamily: "Nunito Sans, Avenir Next, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
  body:
    fontFamily: "Nunito Sans, Avenir Next, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Nunito Sans, Avenir Next, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "0.08em"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  2xl: "1.125rem"
  pill: "999px"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.25rem"
  6: "1.5rem"
  8: "2rem"
  10: "2.5rem"
  12: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.lagoon-deep}"
    textColor: "{colors.text-on-night}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.lagoon-signal}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.md}"
  button-violet:
    backgroundColor: "{colors.compass-violet}"
    textColor: "{colors.text-on-night}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.75rem"
  button-secondary:
    backgroundColor: "{colors.shell-paper}"
    textColor: "{colors.text-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.75rem"
  input-field:
    backgroundColor: "{colors.shell-paper}"
    textColor: "{colors.text-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.75rem"
  chip-action:
    backgroundColor: "{colors.lagoon-mist}"
    textColor: "{colors.lagoon-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 0.75rem"
    height: "2.75rem"
  panel-operational:
    backgroundColor: "{colors.shell-paper}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
  panel-editorial:
    backgroundColor: "{colors.shell-paper}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.2xl}"
    padding: "2rem"
---

# Design System: Ask Siargao

## Overview

**Creative North Star: "The Island Field Desk"**

Ask Siargao feels like a capable local decision desk set inside the island rather than a generic
travel brochure or software dashboard. Deep coastal night establishes place and confidence; warm
paper surfaces bring the actual work into clear view. Editorial type and real island imagery create
character, while operational screens remain compact, legible, and direct.

The system is grounded, reassuring, locally alert, editorial, and practical. It favors strong
hierarchy, quiet containers, visible evidence states, and a few decisive signals over decorative
abundance. It explicitly avoids generic tropical kitsch, glossy resort luxury, and interchangeable
AI-dashboard styling.

**Key Characteristics:**

- Deep coastal frames around warm, paper-like working surfaces.
- Editorial serif moments paired with highly legible operational sans serif.
- Lagoon actions, compass-violet controls, and sparing sunset signals.
- Restrained depth: borders and tonal layers first, ambient lift only when hierarchy needs it.
- Field-tool practical components with editorial warmth and clear state changes.

## Colors

The palette moves from after-dark navy and reef tones into shell paper, then uses clear island
signals for action, orientation, confidence, and warning.

### Primary

- **Deep Island Night** (`deep-island-night`): the dominant public-page frame, app navigation
  ground, and highest-contrast brand surface.
- **Lagoon Signal** (`lagoon-signal`): the recognizable action color for primary pathways, active
  guidance, and positive emphasis.
- **Lagoon Deep** (`lagoon-deep`): the accessible action and icon anchor used when Lagoon Signal
  needs stronger contrast on pale surfaces.

### Secondary

- **Compass Violet** (`compass-violet`): orientation, personalization, account actions, and
  secondary product controls. It should not compete with lagoon calls to action.
- **Pass Violet Night** (`pass-violet-night`): the deepest violet anchor reserved for premium
  Trip Pass atmosphere and layered with the existing compass-violet family.
- **Lagoon Mist** (`lagoon-mist`): quiet selected states, supportive chips, and icon wells.
- **Violet Mist** (`violet-mist`): secondary control backgrounds and low-pressure interactive
  states.

### Tertiary

- **Sunline Gold** (`sunline-gold`): small labels, sequence markers, prices, and warm attention.
- **Sunset Coral** (`sunset-coral`): selective tropical temperature and disruption emphasis, never
  a default action color.
- **Confidence High**, **Confidence Medium**, and **Risk High** (`confidence-high`,
  `confidence-medium`, `risk-high`): semantic status colors whose meaning takes priority over
  decoration.

### Neutral

- **Shell Paper** (`shell-paper`): the clearest content and workspace surface.
- **Warm Paper** and **Sand Paper** (`warm-paper`, `sand-paper`): surrounding canvas and nested
  tonal separation.
- **Deep Reef** (`deep-reef`): the green-black coastal companion to Deep Island Night in sidebars
  and atmospheric gradients.
- **Storm Reef** (`storm-reef`): the blue-green night edge that closes application backdrops
  without introducing a new accent family.
- **Strong Ink** and **Muted Ink** (`text-strong`, `text-muted`): primary and supporting copy on
  paper surfaces.
- **Soft Ink** (`text-soft`): de-emphasized supporting copy on paper surfaces where small text must
  remain readable; it is not a substitute for Dusk Lavender on dark surfaces.
- **Shell Light** and **Dusk Lavender** (`text-on-night`, `text-on-night-muted`): primary and
  supporting copy on dark surfaces.
- **Soft Lavender Border** (`border-soft`): the recurring cool divider and container boundary.

### Named Rules

**The Night-and-Paper Rule.** Deep Island Night frames the experience; Shell Paper carries the
work. Do not flatten both into a single undifferentiated surface.

**The Signal Hierarchy Rule.** Lagoon communicates the main path, violet orients secondary tools,
and sunset hues draw brief attention. Using them interchangeably breaks the decision hierarchy.

**The Semantic Color Rule.** Confidence and risk colors retain their meaning everywhere and are
never borrowed as decorative accents.

## Typography

**Display Font:** Cormorant Garamond, with Iowan Old Style, Georgia, and Times New Roman fallbacks.

**Body Font:** Nunito Sans, with Avenir Next, Segoe UI, system-ui, and sans-serif fallbacks.

**Character:** Cormorant Garamond gives the island identity an editorial, human voice. Nunito Sans
keeps decisions, evidence, controls, and dense operational content calm and highly legible.

### Hierarchy

- **Display** (600, responsive `3rem`–`7.6rem`, `0.92` line height): landing-page promises and the
  rare statement that defines an entire surface.
- **Headline** (600, around `3rem`, `0.98` line height): page-level editorial titles and major
  public section leads.
- **Operational title** (600, `1.25rem`–`1.5rem`, `1.25`–`1.33` line height): chat, settings,
  dialogs, and workspace headings where speed matters more than atmosphere.
- **Body** (400–700, `0.875rem`–`1rem`, `1.5`–`1.7` line height): explanations and decision detail.
  Keep longer reading lines near `38`–`48ch`; operational columns may be narrower.
- **Label** (700–800, `0.75rem`–`0.875rem`, up to `0.08em` tracking): navigation, metadata, source
  states, and uppercase eyebrows. Uppercase is reserved for short orientation labels.

### Named Rules

**The Two-Register Rule.** Cormorant Garamond carries brand and editorial moments; Nunito Sans
carries operational screens, controls, evidence, and dense information.

**The Weight-Before-Size Rule.** Operational hierarchy usually changes weight and color before it
adds another font size. Dense surfaces should not become a staircase of oversized headings.

## Layout

The public landing page uses an expansive asymmetric editorial grid: a text-led hero and coastal
image sit side by side on large screens, then become one stacked narrative on mobile. The outer
frame uses responsive gutters of roughly `1.25rem`, `2rem`, and `3rem` and can expand to a broad
`112rem` canvas. Major paper sections use generous `2rem`–`3rem` padding on desktop and compress to
`1rem`–`1.25rem` on mobile.

Operational surfaces are denser. The shared app shell is bounded near `73.75rem`; chat becomes a
three-column field desk at `73.75rem` and above, with a dark navigation rail, central paper
workspace, and compact context rail. Below that threshold, secondary rails collapse and context
moves into mobile controls or overlays. Repeated details use line items and tonal groups instead of
nested cards.

Spacing follows a `0.25rem` base rhythm. Use `0.5rem`–`0.75rem` inside compact evidence and control
groups, `1rem`–`1.5rem` inside standard panels, and `2rem`–`3rem` between major narrative regions.
Maintain a minimum interactive height of `2.75rem` for traveler-facing controls whenever space
allows.

Every top-level route begins with a keyboard-first skip link before the application chrome. It
stays visually off-canvas at rest, reveals itself on focus without shifting layout, and transfers
focus to the route's primary content landmark.

**The Narrative-to-Workbench Rule.** Persuasive surfaces may breathe and use asymmetry; operational
surfaces compress into aligned columns and scannable rows without losing the same palette or voice.

**The One-Scroll-Owner Rule.** Full-height workspaces give each column one deliberate scrolling
region. Avoid nested scroll traps inside chat, context, or settings panels.

**The Direct-to-Work Rule.** Preserve one first-focus skip link and one `main-content` landmark on
every top-level surface so keyboard users can bypass repeated navigation immediately.

## Elevation & Depth

The elevation philosophy is layered but restrained. Borders and tonal separation establish most
hierarchy. Ambient shadows lift primary panels and overlays, while ordinary cards and repeated rows
remain flat. Media frames and calls to action may receive a more atmospheric shadow when they carry
the page's focal point.

### Shadow Vocabulary

- **Flat** (`none`): default cards, line items, chips, and supporting groups.
- **Panel** (`0 1px 2px rgba(14, 12, 56, 0.08), 0 10px 28px rgba(14, 12, 56, 0.08)`): bounded
  workspaces and major paper sections.
- **Overlay** (`0 1px 2px rgba(8, 8, 38, 0.12), 0 18px 48px rgba(8, 8, 38, 0.18)`): dialogs,
  sheets, and transient UI above the workspace.
- **Lagoon action** (`0 6px 18px rgba(20, 184, 166, 0.22)`): primary call-to-action emphasis.
- **Coastal frame** (`0 18px 56px rgba(0, 0, 0, 0.34)`): rare large island imagery against the
  night shell.

### Named Rules

**The Flat-by-Default Rule.** Repeated content stays flat. A shadow must explain a panel boundary,
transient layer, or singular focal point.

**The Border-before-Shadow Rule.** Reach for the Soft Lavender Border or a tonal change before
adding elevation to an operational surface.

## Shapes

The operational form language is gently squared: standard containers use `0.5rem` corners,
controls use `0.5rem`–`0.625rem`, and small icon wells repeat the same geometry. Editorial panels
may open to `0.875rem`–`1.125rem` corners, especially on the landing page. Pills are reserved for
compact navigation, prompts, filters, and status chips. The circular palm medallion is the one
recurring fully round brand silhouette.

Borders are usually one pixel and cool lavender on paper or translucent shell on dark surfaces.
Repeated rows prefer a single top divider over individually rounded containers. Images may clip to
the larger editorial radius but should not introduce unrelated organic masks.

**The Gentle-Square Rule.** Default to the shared medium radius. Larger curves signal a narrative
or promotional surface, not a different design system.

**The No-Card-Confetti Rule.** Do not wrap every fact in its own rounded card. Use line items,
dividers, and tonal groups for repeated operational content.

## Components

Components feel field-tool practical with editorial warmth: decisive controls, quiet containers,
clear states, and a small number of expressive moments.

### Buttons

- **Shape:** gently squared (`0.5rem`–`0.625rem`) with a default traveler-facing height of
  `2.75rem`; icon-only actions remain square.
- **Primary:** lagoon fill with Shell Light text; major landing actions may use the lagoon gradient
  and a restrained lagoon shadow.
- **Violet:** account, edit, save, and secondary product actions use Compass Violet rather than
  competing with the primary lagoon pathway.
- **Secondary / outline:** Shell Paper or translucent night surfaces with visible borders and no
  resting shadow.
- **Hover / focus:** shift one tonal step, then show a high-contrast three-pixel focus ring. Active
  press may move down by one pixel. Disabled controls keep their footprint and reduce opacity.

### Chips

- **Style:** pills or compact rounded rectangles with strong short labels. Use Lagoon Mist for
  positive selection, Violet Mist for secondary prompts, and translucent shell on dark surfaces.
- **State:** selected chips change both fill and text emphasis; semantic chips retain their status
  color. Chips should not masquerade as full primary buttons.

### Cards / Containers

- **Corner style:** `0.5rem` operational panels; `0.875rem`–`1.125rem` editorial panels.
- **Background:** Shell Paper for primary content, Warm Paper or Sand Paper for nested support, and
  translucent shell or reef tones on night surfaces.
- **Shadow strategy:** flat by default; use Panel only for a bounded workspace or major section.
- **Border:** one-pixel Soft Lavender Border on paper; translucent Shell Light on dark surfaces.
- **Internal padding:** `1rem`–`1.5rem` operationally and up to `2rem`–`3rem` for major editorial
  regions.

### Inputs / Fields

- **Style:** Shell Paper or white fill, Soft Lavender Border, gently squared corners, and Nunito
  Sans input text. Labels sit above the field in a bold operational register.
- **Focus:** border shifts to lagoon or violet according to the owning flow, with a three-pixel
  low-opacity ring.
- **Error / disabled:** risk red is reserved for the invalid boundary; disabled fields keep layout,
  soften their fill, and reduce opacity without removing labels.

### Navigation

Public navigation is a restrained translucent pill on Deep Island Night. The chat navigation rail
is a solid night-to-reef column with short uppercase orientation labels, visible dividers, and a
single lagoon primary action. On mobile, navigation collapses to the brand lockup and direct task
actions rather than reproducing a miniature desktop rail.

### Decision and Evidence Surfaces

Decision strips, source receipts, weather, surf, and trip-context groups are signature field-desk
components. They use dense Nunito Sans typography, compact icons, explicit labels, and tonal rows.
Animation is brief and directional (`140ms`–`360ms` with a decisive standard ease); answer-arrival
motion may briefly reveal sequence but must disappear at rest and respect reduced-motion settings.

## Do's and Don'ts

### Do:

- **Do** frame public and navigation surfaces in Deep Island Night while keeping task content on
  warm paper.
- **Do** use Lagoon Signal for the main path and Compass Violet for secondary orientation or account
  controls.
- **Do** preserve the Two-Register Rule when moving between editorial and operational surfaces.
- **Do** prefer one-pixel borders, tonal layers, and line items before adding shadow or another card.
- **Do** keep controls visibly focused, at least `2.75rem` tall when practical, and compatible with
  reduced motion.
- **Do** preserve the first-focus skip link, unique `main-content` landmark, and three-pixel focus
  treatment on every top-level surface.
- **Do** use real island imagery as a contextual frame, with dark overlays strong enough to protect
  text contrast.

### Don't:

- **Don't** turn the palette into generic turquoise-on-white tropical branding; the deep night and
  warm paper relationship is essential.
- **Don't** use lagoon, violet, gold, coral, confidence, and risk colors interchangeably.
- **Don't** set dense evidence, settings, or chat controls in the display serif.
- **Don't** create glossy resort-luxury effects, ornamental tropical motifs, or generic AI gradient
  decoration.
- **Don't** stack rounded elevated cards inside rounded elevated cards.
- **Don't** add persistent decorative motion; animation should clarify state or sequence and then
  leave the field desk quiet.
