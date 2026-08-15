---
target: homepage paid option prominence for free-to-paid conversion
total_score: 21
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 3
timestamp: 2026-08-15T18-18-19Z
slug: src-app-page-tsx
---
Method: dual-agent (A: homepage_design_review · B: homepage_detector_evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Destinations and prompt-prefill behavior are clear; the marketing surface has little dynamic state. |
| 2 | Match System / Real World | 3 | Traveler language is strong, but “bounded call,” “evidence-backed call,” and “settings” expose internal vocabulary. |
| 3 | User Control and Freedom | 3 | Chat and guide exits are clear, but section navigation disappears below the `xl` breakpoint. |
| 4 | Consistency and Standards | 4 | Typography, color, geometry, CTA treatment, and section language form a cohesive system. |
| 5 | Error Prevention | 3 | Visitors can review the example before sending and payment activation is explained; account and checkout prerequisites arrive late. |
| 6 | Recognition Rather Than Recall | 2 | Paid availability, price, and prerequisites are hidden far below the initial activation decision. |
| 7 | Flexibility and Efficiency | n/a | This is a Persuade surface rather than an operational workflow. |
| 8 | Aesthetic and Minimalist Design | 3 | The hierarchy is attractive, but the middle repeats the mechanism and delays the commercial decision. |
| 9 | Error Recovery | n/a | There is no recoverable workflow on this static marketing surface. |
| 10 | Help and Documentation | n/a | This is a Persuade surface; legal and contextual detail is nevertheless available. |
| **Total** | | **21/28** | **Good, with a major conversion-hierarchy gap.** |

## Design Specificity Verdict

**Visually specific, commercially generic.** The island field-desk world is strongly authored: deep coastal night, shell-paper work surfaces, editorial serif, real Siargao imagery, and cautious evidence language feel coherent and place-specific. The commercial story is less specific. The hero demonstrates a prompt, not the proprietary result: a keep/change/avoid decision, visible evidence, uncertainty, and a concrete next move. The visitor therefore sees a polished travel assistant before they see why its answers deserve payment.

**Deterministic scan:** `detect.mjs` returned `[]` with exit code 0 for `src/features/landing/LandingPage.tsx`: zero findings, rules, locations, or false positives. The detector did not encode the business-priority hierarchy failure proven by browser geometry, so the clean result is a detector blind spot rather than evidence that conversion discovery is healthy.

**Visual overlays:** no reliable user-visible overlay is available. Browser mutation failed during preflight because the page document was read-only (`TypeError: Cannot set property title of [object Object] which has only a getter`). No helper server was started and no overlay was claimed. The fallback evidence is the clean CLI scan, source order, accessibility snapshots, stable screenshots, and measured viewport geometry.

## Overall Impression

The homepage earns trust and makes the first free Reality Check feel easy. It fails to turn that activation into a transparent commercial ladder. The paid module is clear once reached, but almost everything before it encourages a free action or sends the visitor elsewhere. The single biggest opportunity is to introduce the free-to-paid ladder in the hero and move the full Trip Pass decision before the guide directory.

## What’s Working

1. **A memorable, credible visual world.** Night-and-paper contrast, restrained lagoon action color, real island imagery, and the editorial/operational type pairing feel grounded rather than resort-glossy.
2. **Immediate low-risk activation.** “Try this example” preloads a specific Cloud 9 question and explicitly lets the visitor review it before sending.
3. **Strong trust and accessibility foundations.** The page has a skip link, coherent headings, visible text labels, 44px-or-larger sampled controls, reduced-motion handling, uncertainty boundaries, and discoverable legal/privacy copy. Desktop, laptop, and mobile measurements showed no horizontal overflow.

## Cognitive Load

**Moderate: 3 checklist failures.** Chunking, grouping, visual hierarchy, working-memory support, and progressive disclosure are sound. The failures are single focus, one thing at a time, and minimal choices. Desktop exposes ten actionable links in the first viewport; mobile exposes six actions before any offer mention. When visitors finally reach Trip Pass, the section presents free, paid, terms, refunds, privacy, and duplicate paid calls to action in one decision area.

## Emotional Journey

The page opens with a confident visual peak and quickly makes a free trial feel safe. Conversion momentum then disperses across repeated mechanism explanation and six guide exits. The revenue proposition arrives after those exits, and the journey ends on “settings,” checkout availability, and legal detail. For conversion, the peak-end pattern is backwards: the emotional peak is the sunset, while the end is administration. A visible decision artifact and a trip-long coverage promise should become the second peak.

## Priority Issues

### [P1] The commercial ladder is effectively hidden

**Why it matters:** Trip Pass begins 2.37 desktop screens, 2.83 common-laptop screens, and 3.20 mobile screens below the top. The only Trip Pass anchor is hidden below `xl`, so typical laptop and mobile visitors receive no signal that a paid product exists. Free activation and paid packaging feel unrelated.

**Fix:** Add a compact offer bridge beside or immediately below the hero action: “10 free answers for 7 days · 14-day Trip Pass, 150 answers, $9.99.” Keep the free action primary, but make the commercial ladder transparent. Move the full pricing section directly after one convincing product-proof section and before the six-link guide directory. Preserve a visible Trip Pass route below `xl`.

**Suggested command:** `$impeccable layout`

### [P1] The hero demonstrates input, not differentiated value

**Why it matters:** Visitors are asked to value 150 answers without seeing why an Ask Siargao answer is better than generic travel chat. The large coastal image carries more visual weight than the product’s proprietary decision mechanism.

**Fix:** Turn the example into a compact before/after artifact: traveler plan → `change`/`keep`/`avoid` state → two evidence labels → concrete next move → honest local-confirmation boundary. Label it as a demo rather than presenting fabricated customer proof.

**Suggested command:** `$impeccable shape`

### [P1] Free and paid are not meaningfully differentiated

**Why it matters:** The two offer cards use almost identical visual hierarchy. “10 answers over 7 days” can sound sufficient, while “150 over 14 days” feels like a larger meter rather than a different trip-planning experience.

**Fix:** Give the paid option the reserved premium-violet atmosphere and a clear use case: active planning throughout the trip. Contrast 15× the answers, twice the duration, and $9.99 without hype. Keep free as the quiet “start here” option and make paid the recommended coverage for travelers planning and adapting day by day.

**Suggested command:** `$impeccable bolder`

### [P2] The purchase CTA exposes implementation friction

**Why it matters:** “Get Trip Pass in settings” describes an internal location, not the thing being purchased. Sign-in and checkout availability appear at the moment of highest intent, inviting doubt and interruption.

**Fix:** Use “Get the 14-day Trip Pass — $9.99.” Place concise reassurance beside it: “Sign in to continue. Access starts after payment is confirmed.” Keep one paid CTA per decision point and demote terms/privacy links beneath it.

**Suggested command:** `$impeccable clarify`

## Persona Red Flags

**Jordan, first-timer:** Jordan can understand the example, but not the whole offer. No free quota, paid price, or recommended upgrade moment appears near activation. “Bounded call” and “settings” require translation, and the sign-in redirect is not explained until much later.

**Riley, deliberate stress tester:** Riley appreciates the honest evidence and legal boundaries, but checkout availability cannot be verified until sign-in. The 150-answer promise does not surface temporary-rate-limit implications near the offer, and “when available” creates a trust question inside the purchase path.

**Casey, distracted mobile traveler:** Casey can reach the free action one-handed, but Trip Pass is more than three phone screens down after six guide exits. There is no mobile Trip Pass anchor, and the purchase path adds sign-in plus settings navigation at the point most vulnerable to interruption.

## Minor Observations

- Guides and Chat receive equal header emphasis even though Chat is the activation path.
- The pricing section places “Start 10 free answers” before the paid choice, reinforcing free intent.
- The duplicated paid CTA adds weight without adding confidence.
- The guide directory is useful for SEO and discovery but acts as a conversion exit ramp.
- The mobile header drops the Ask Siargao wordmark, weakening first-time brand recognition.
- Accessibility semantics and target sizes look sound; automated contrast and end-to-end keyboard focus behavior were not proven in this run.

## Questions to Consider

1. Should the upgrade trigger be “I need more than 10 answers,” “I’m staying longer than a week,” or “I want Ask Siargao throughout the trip”? The strongest commercial story is the third.
2. What truthful completed Reality Check can replace part of the sunset and prove why these answers deserve payment?
3. Why should a traveler pass through an SEO guide directory before learning the product’s price and paid value?
4. If “settings” disappeared from the CTA, what would the traveler believe they are buying, and can that promise be made explicit before sign-in?
