---
target: src/features/landing/LandingPage.tsx
total_score: 20
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 3
timestamp: 2026-08-07T01-04-31Z
slug: src-features-landing-landingpage-tsx
---
Method: dual-agent (A: landing_design_review · B: landing_detector_evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Anchor navigation has no current-section state, and the preset hero action does not preview what will happen. |
| 2 | Match System / Real World | 3/4 | Traveler scenarios are concrete, but phrases such as “request-time evidence,” “not-checked boundaries,” and “needs-confirmation” sound internal. |
| 3 | User Control and Freedom | 3/4 | Navigation is safe and reversible, but the hero preset cannot be edited or cleared before entering chat. |
| 4 | Consistency and Standards | 3/4 | The visual system is coherent, but nominally similar lagoon CTAs resolve to inconsistent text colors and meanings. |
| 5 | Error Prevention | 2/4 | The input-like static prompt and ambiguous “Start free” route can create unintended prompt or purchase expectations. |
| 6 | Recognition Rather Than Recall | 3/4 | Examples and icons work well, but users must connect the paid card to a separated settings link. |
| 7 | Flexibility and Efficiency | n/a | This Persuade surface has no repeated expert workflow. |
| 8 | Aesthetic and Minimalist Design | 3/4 | The hero is disciplined; the pricing and differentiator block becomes disclosure-heavy. |
| 9 | Error Recognition and Recovery | n/a | This landing surface contains no user-entered or error-producing state. |
| 10 | Help and Documentation | n/a | Separate help documentation is not required for this persuasive surface. |
| **Total** | | **20/28** | **Good (71%); conversion clarity needs work.** |

## Design Specificity Verdict

**LLM assessment:** Strongly authored for Ask Siargao rather than category-interchangeable. The night-and-paper composition, palm medallion, real island imagery, editorial serif, constraint-led scenarios, and explicit keep/change/avoid/needs-confirmation mechanism form a credible “Island Field Desk.” An unrelated AI or travel product could not adopt this page unchanged. The weakest stretch is Trip Pass, where the authored story flattens into conventional SaaS pricing cards and administrative caveats.

**Deterministic scan:** The detector returned 12 advisory `design-system-font-size` findings, all in `src/features/landing/LandingPage.tsx`. It flagged off-ramp values at lines 182 (`1.55rem`, `2rem`, `2.25rem`), 230 (`0.94rem`), 297 (`0.68rem`), 353 (`2.65rem`), 358 (`0.94rem`), 384 (`1.45rem`, `1.7rem`), 387 (`0.96rem`), 468 (`1.55rem`), and 531 (`1.7rem`). Several display/title sizes are plausible optical adjustments, but the near-duplicate body and label sizes are genuine token drift.

**Visual overlays:** No reliable user-visible overlay is available. Mutable injection failed because the browser evaluation surface exposed `document.title` as getter-only; the preflight script was not appended. The fallback evidence was a fresh browser inspection with screenshots, computed colors, DOM geometry, overflow checks, and touch-target measurements at 1440×1000 and 390×844.

## Overall Impression

The page opens with unusual confidence: it feels local, editorial, restrained, and honest about uncertainty. Its single biggest opportunity is to make action behavior as authored as the visual world. The hero looks like a question composer but behaves like a preset link, while the strongest commercial moment—the $9.99 Trip Pass—has no adjacent paid action. The page persuades visitors that the product is thoughtful, then makes them infer what to do.

## What’s Working

1. **The island-field-desk identity is real.** Deep coastal night, warm paper, the palm mark, coastal photography, and the editorial/operational type pairing establish a recognizable product world without tropical kitsch or resort gloss.

2. **The promise is grounded in actual traveler decisions.** Hotels, no-scooter routes, surf sessions, weather, and disruptions make the mechanism concrete. “When asked,” “local eyes,” and bounded uncertainty language protect trust instead of promising omniscience.

3. **Responsive composition is disciplined.** The editorial hierarchy survives at 390px, desktop navigation collapses correctly, and no horizontal overflow appeared at either tested viewport. Keyboard focus is visible and most primary controls meet the 44px interaction floor.

## Priority Issues

### [P1] The hero composer is a false affordance

**Why it matters:** The large white prompt panel visually reads as an editable input, but it is static and sends a preset Cloud 9 question. First-time users may try to type, misunderstand what will be submitted, or enter chat with a question they did not author.

**Fix:** Choose one honest model. Prefer a real labeled text input whose quick chips populate or refine the question. If the preset is intentionally demonstrative, label the surface “Example Reality Check,” remove input-like styling, and rename the CTA “Try this example.”

**Suggested command:** `$impeccable clarify`

### [P1] Trip Pass intent peaks without a direct paid action

**Why it matters:** The $9.99 card creates high purchase intent, but “Start free” routes to chat while the paid path is a separate “Manage pass in settings” link. Launch availability, Stripe authority, and policy links become the final emotional note. This makes the offer feel provisional and weakens conversion precisely at the peak.

**Fix:** Add one auth-aware primary action inside the paid card, such as “Get Trip Pass in settings.” Rename the free action “Start 10 free answers.” Keep launch availability concise beside the paid CTA, move processor detail into terms, and end the page with one confident next move.

**Suggested command:** `$impeccable clarify`

### [P1] Lagoon CTA contrast is inconsistent and not robust

**Why it matters:** Live computed styles showed the hero CTA using dark text while “Start free” uses shell text over the same gradient. Shell text varies from approximately 2.37:1 to 5.74:1 across the gradient; dark text varies from 6.59:1 to 2.72:1. Parts of both treatments fail normal-text contrast, and the same visual role produces different results.

**Fix:** Replace the mixed gradient with a contrast-stable token: solid Lagoon Deep with shell text, or a uniformly light lagoon surface with dark ink. Remove the class collision so every primary CTA resolves to the same text color, hover state, and focus treatment.

**Suggested command:** `$impeccable colorize`

### [P2] The page explains the mechanism more than it demonstrates it

**Why it matters:** Five differentiator bullets, evidence phrases, caveats, and pricing disclosures accumulate below the hero. On mobile the page reaches roughly 2,980px, and the final card asks visitors to hold too many concepts at once. Capability claims are accurate, but a concrete output specimen would earn trust faster.

**Fix:** Replace most of the differentiator list with one compact structural specimen: traveler plan → checked inputs → bounded call → next step. Translate internal phrases into traveler language and progressively disclose governance detail. Keep factual claims within the supplied product truth.

**Suggested command:** `$impeccable distill`

### [P2] The typography ramp has accumulated near-duplicate sizes

**Why it matters:** Twelve detector advisories show that small optical adjustments have become a second, undocumented type scale. Values such as `0.94rem`, `0.96rem`, and `0.68rem` make hierarchy harder to reason about and can create subtle inconsistency across breakpoints.

**Fix:** Preserve intentional display interpolation where it improves composition, but consolidate body, label, and card-title sizes onto the documented typography roles. If a recurring optical size is genuinely needed, name it once in the design system rather than scattering literals.

**Suggested command:** `$impeccable typeset`

## Persona Red Flags

**Jordan — first-time visitor:** Jordan will likely interpret the white hero panel as an input, then be surprised that it submits a fixed question. “Request-time evidence” and “needs-confirmation” require translation, and “Start free” does not make the free allowance explicit.

**Casey — distracted mobile traveler:** Casey gets a strong, thumb-reachable hero action but must traverse a roughly 2,980px page and a dense five-bullet pricing block before finding the paid settings path. The separated action is easy to miss under travel-time pressure.

**Riley — skeptical evaluator:** Riley will notice that the $9.99 offer is non-interactive, “Start free” leads elsewhere, and the availability caveat makes the offer appear unfinished. The contrast inconsistency between nominally equivalent CTAs also reads as implementation drift.

## Minor Observations

- Desktop header presents five destinations; “Start a question” and “Ask in chat” overlap semantically.
- The mobile links “Manage pass in settings” and “Terms, privacy, and refunds” measured 40px high, below the 44px target.
- Planning-input accessible copy repeats phrases such as “Can check when asked. Can check forecasts when asked.” One concise phrase would be clearer.
- “Local eyes” is warm but slightly opaque; a concrete local-confirmation phrase would be easier to act on if product policy permits it.
- The page ends without a footer or final primary CTA, reinforcing the provisional close.
- No horizontal overflow was found at desktop or mobile widths.

## Questions to Consider

- Is the hero supposed to accept the traveler’s own question or demonstrate a preset? Its visual language and behavior currently answer differently.
- Why does the $9.99 intent peak lead most visibly to “Start free” rather than the paid path?
- Could one honest output specimen earn more trust than five capability claims?
- Should the final emotional note be operational/legal caveat, or a confident next move?
