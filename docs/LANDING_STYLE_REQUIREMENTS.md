# Landing And Chat Mockup Requirements

This document is the implementation brief for the current Ask Siargao mockups in `design/`:

- `design/web-landing.png`
- `design/web-chat-page.png`
- `design/mobile.png`

The implementation should match these mockups closely. The product is Ask Siargao: a chat-first Siargao travel assistant. Do not reintroduce the old risk-audit framing, long intake form, or report-first workflow.

## Shared Brand Direction

Ask Siargao uses a dark coastal travel theme with a refined assistant UI.

Required visual traits:

- dark navy and midnight indigo app background
- violet and purple primary actions
- warm Siargao sunset photography with palm silhouettes
- white or near-white glass panels for prompt and content cards
- soft violet glows around focused cards and CTAs
- rounded cards, but not pill-only UI
- compact green freshness and confidence badges
- occasional yellow confidence badge for medium confidence
- serif display headline for the landing hero
- clean sans-serif UI text for navigation, cards, chat, and controls

Use the current Siargao sunset image as the core background asset. Image placement should preserve the pink-purple sky and palm silhouettes as seen in the mockups.

## Desktop Landing Page

Source mockup: `design/web-landing.png`.

### Container

The desktop landing page is framed as a browser-like dark canvas:

- full page background: deep navy/purple
- inner page frame: rounded rectangle with a subtle violet border
- top-left browser dots: red, yellow, gray
- content sits over the Siargao sunset image
- image is darkened enough for white text but remains recognizable

### Header

Header layout:

- left: circular palm logo icon and `Ask Siargao`
- center/right nav links:
  - `How it works`
  - `Where to stay`
  - `What's happening`
  - `Weather`
  - `Saved places`
- far right CTA button: `Open assistant`

The CTA is a solid violet gradient button with white text and a soft glow.

### Hero Copy

Hero headline must match the mockup:

```text
Ask Siargao
anything about
your trip.
```

The words `your trip.` are italic and violet/lavender.

Hero supporting copy:

```text
Local answers for where to stay, what to do,
how to get around, and what today's
weather changes.
```

The headline is large, white, editorial, and left-aligned. The support copy is smaller, white/lavender, and constrained to the same left column.

### Prompt And Weather Row

Below the hero copy, show a two-column row:

- left: large white chat prompt card
- right: compact white `Today in Siargao` weather card

Prompt card content:

```text
I'm staying near Cloud 9 for 10 days. We want quiet
sleep, surfing, good restaurants, and easy airport
transfer. What should we know?
```

Prompt card controls:

- sparkle icon at the start of the prompt
- small square plus button
- small square globe button
- violet `Ask Siargao` button with send icon

Weather card content:

- title: `Today in Siargao`
- rows:
  - `Forecast` / `Partly cloudy`
  - `Rain chance` / `35%`
  - `Wind` / `18 km/h`
  - `Freshness` / `Updated 12 min ago`

The freshness value is a green rounded badge.

### Suggestion Chips

Under the prompt/weather row, show:

```text
Try asking about...
```

Then horizontal chips:

- `quiet hotel?`
- `best restaurants nearby`
- `airport transfer`
- `parties this weekend`
- `weather today`

Each chip has a small icon, dark translucent fill, violet border, and white/lavender text.

### Trust Row

Below the chips, show a centered trust row with three items separated by vertical dividers:

- `Live local data`
- `No booking bias`
- `Freshness + confidence shown`

Each item has a small violet line icon.

### Bottom Feature Cards

At the bottom of the desktop landing mockup, show four white cards:

1. `Find the right areas`
   - `Compare Cloud 9, General Luna, Catangnan and more to match your vibe.`
   - link: `Explore areas`
2. `Live weather updates`
   - `Real-time conditions, rain chances, wind, and sea changes.`
   - link: `Check weather`
3. `Local food & drinks`
   - `Curated spots and hidden gems for every craving and budget.`
   - link: `See restaurants`
4. `Get around easily`
   - `Airport transfers, scooters, tricycles, and local tips that save time.`
   - link: `Plan transport`

Each card has a violet circular icon area, strong navy title, muted body text, and violet link with arrow.

## Desktop Chat Page

Source mockup: `design/web-chat-page.png`.

The desktop assistant should copy the proven ChatGPT-style workspace structure while keeping the Ask Siargao theme.

### Overall Layout

Use a three-column layout:

- left dark sidebar
- central chat column on a light background
- right context sidebar with cards

The outer shell uses the same browser-like rounded frame and top-left browser dots as the landing mockup.

### Left Sidebar

Sidebar visual style:

- dark navy/purple background
- Ask Siargao logo at top
- white text with lavender secondary text
- violet primary action button
- subtle separators
- bottom referral card with sunset image

Top button:

```text
+  New question  →
```

Sections and content:

`CURRENT TRIP`

- active trip card:
  - `June surf trip`
  - `Jun 12-22`
  - small traveler count `2`

`SAVED PLACES`

- `Cloud 9 shortlist` / `4 places`
- `General Luna food spots` / `7 places`
- `Catangnan cafés` / `3 places`
- link: `View all saved places`

`RECENT QUESTIONS`

- `Is this hotel quiet?` / `10:42 AM`
- `Best dinner near Catangnan` / `Yesterday`
- `Will it rain this afternoon?` / `Yesterday`
- `Surf conditions tomorrow?` / `2 days ago`
- link: `View all history`

Bottom referral card:

- `Love Ask Siargao?`
- `Invite friends and unlock extra refreshes.`
- `Invite friends →`

### Chat Header

Top of central column:

- title: `Ask Siargao`
- status: green dot + `Local travel assistant`
- right icons: history/refresh-style icon, share icon, user avatar

### Conversation Content

The central conversation should match the mockup rhythm:

- user messages are right-aligned lavender/violet bubbles
- assistant messages are left-aligned white cards with the palm avatar
- timestamps appear in small muted text
- assistant answers can include evidence/recommendation cards inside the message

Conversation shown in the mockup:

User:

```text
Is this accommodation near Cloud 9 quiet at night?
```

Assistant:

```text
Yes, it's generally quiet at night. It sits on a small lane
set back from the main road, and most guests mention
low noise after 10pm.
```

Evidence card:

- image thumbnail
- title: `Harana Surf Resort`
- metadata: `Guest reviews (May 2024)`
- quote:
  - `"Very quiet at night, slept well every night."`
  - `— Guest review`
- badges:
  - `Fresh`
  - `High confidence`
  - `Updated 12m ago`
  - `Local source`

User:

```text
Where should we eat tonight near Cloud 9?
```

Assistant:

```text
Here are great dinner spots within 10 minutes of Cloud 9
with good reviews tonight.
```

Recommendation cards:

- `Kermit Siargao`
  - `Filipino · Seafood · Sunset views`
  - `Grilled tuna, kinilaw, fresh prawns`
- `Shaka Café`
  - `Fusion · Healthy · Vegetarian options`
  - `Bowls, tacos, smoothies`
- `Bravo Restaurant`
  - `Italian · Wood-fired pizza · Pasta`
  - `Pizza, handmade pasta, great wines`

Each recommendation card includes a food thumbnail and badges:

- `Fresh`
- `High confidence`
- `Updated 18m ago`, `Updated 22m ago`, or `Updated 25m ago`
- `Local source`

User:

```text
What weather changes should we expect today?
```

Assistant:

```text
Expect more clouds and a higher chance of rain this afternoon,
with stronger winds later. Best surf early morning.
```

Weather evidence card:

- title: `Siargao Weather Update`
- source line: `PAGASA + Local Station Data`
- body:
  - `Rain chance up to 60% after 2pm.`
  - `Winds increase to 22-25 km/h from the southwest.`
- badges:
  - `Fresh`
  - `High confidence`
  - `Updated 12m ago`
  - `Local source`

### Bottom Composer

Composer is sticky at the bottom of the central chat column.

Above composer, show quick chips:

- `quiet hotels`
- `restaurants tonight`
- `weather now`

Composer:

- plus button on the left
- placeholder: `Ask anything about your Siargao trip...`
- violet circular send button on the right

Small disclaimer below:

```text
Answers use live local data. Check important details before you go.
```

### Right Context Sidebar

Right sidebar uses white cards on a light background.

First card: `Trip context`

Rows:

- `Accommodation` / `Near Cloud 9 / Catangnan`
- `Dates` / `Jun 12-22`
- `Traveler type` / `Couple`
- `Nearby area` / `Cloud 9`
- `Today's weather` / `Partly cloudy, 28°C`
- `Live refreshes remaining` / `4`

Second card: `Cloud 9 Weather`

- icon: partly cloudy
- temperature: `28°C`
- `Feels like 30°C`
- metrics:
  - `Rain chance` / `35%`
  - `Wind` / `18 km/h`
  - `Humidity` / `77%`
- freshness: `Updated 12 min ago`

Third card: `Live surf conditions`

- `Cloud 9`
- green status badge: `Good`
- metrics:
  - `Waves` / `2-3 ft`
  - `Tide` / `Low 0.6 m`
  - `Wind` / `18 km/h SW`
- freshness: `Updated 20 min ago`

Bottom image card:

- sunset beach image
- label: `General Luna, Siargao`
- white button: `View area guide →`

## Mobile Landing And Chat

Source mockup: `design/mobile.png`.

The mobile mockup contains two iPhone screens: landing on the left and chat on the right. The implementation should follow the ChatGPT mobile layout pattern while preserving the Ask Siargao theme.

### Mobile Landing

Mobile landing background:

- full-screen dark Siargao sunset image
- navy overlay
- palm silhouettes visible on the right side
- content centered vertically above and around the prompt card

Top bar:

- left: palm logo and `Ask Siargao`
- right: hamburger menu

Hero headline:

```text
Ask Siargao
anything about
your trip.
```

The `your trip.` line is italic lavender.

Subcopy:

```text
Weather-aware local answers for stays,
food, beaches, transfers, parties,
and practical help.
```

Prompt card:

- large white rounded card
- sparkle icon
- prompt:

```text
I'm staying near Cloud 9 for 10 days.
What should we know?
```

Controls:

- circular plus button
- circular microphone button
- violet `Ask Siargao` CTA with right arrow

Horizontal chips:

- `Quiet sleep`
- `Restaurants`
- `Airport transfer`
- `Weather today`
- `Parties`

Weather card:

- title row: icon + `Today in Siargao`
- right badge: `Updated 12 min ago`
- metrics:
  - `28°C` / `Partly cloudy`
  - `35%` / `Rain chance`
  - `16 km/h` / `Wind · E`
  - `1.3 m` / `Swell`

Bottom trust cards:

- `Local answers` / `From Siargao locals`
- `Fresh & current` / `Live updates all day`

Footer text:

```text
Built for travelers  •  Loved by locals
```

### Mobile Chat

Mobile chat visual style:

- dark navy background
- ChatGPT-like top bar, conversation body, and sticky bottom composer
- message cards use dark translucent surfaces
- user message is right-aligned violet gradient
- assistant message is left-aligned dark glass card with palm avatar

Top bar:

- left: hamburger icon
- center: `Ask Siargao`
- right: compose/new chat icon

Trip context pill below top bar:

```text
Cloud 9 area  ·  Jun 24–Jul 7  ·  24 live refreshes left
```

The pill includes a location icon and dropdown chevron. `24 live refreshes left` is green.

Conversation:

User message:

```text
Will my place be quiet and where
should we eat tonight?
```

Assistant message:

```text
Yes, your place should be quiet most
nights. Cloud 9 is lively in the late
afternoon and early evening, then
it settles down.

For dinner, you have great options
within a short trike ride—fresh,
local, and good vibes.
```

Follow-up cards:

1. `Quiet sleep`
   - image thumbnail of night accommodation
   - `Stay 5-10 min inland from Cloud 9 Rd for the quietest nights.`
   - badges: `Fresh`, `High confidence`
2. `Dinner nearby`
   - image thumbnail of food
   - `Kermit Siargao, Shaka Cafe, Bravo—great food & sunset vibes.`
   - badges: `Fresh`, `High confidence`
3. `Weather impact`
   - image thumbnail of sunset beach
   - `Partly cloudy tonight with a light E wind—perfect for beach dining.`
   - badges: `Fresh`, `Medium confidence`

Each follow-up card has a right chevron and should be tappable.

Bottom composer:

- dark rounded input container
- left circular plus button
- placeholder: `Ask anything about Siargao...`
- microphone button
- violet circular send/up-arrow button

Footer note:

```text
Answers reflect live local updates
```

Use a green dot before the footer note.

## Interaction And Responsive Rules

- Desktop landing CTA `Open assistant` should navigate to the assistant/chat page.
- Landing prompt `Ask Siargao` should start a chat with the prompt text.
- Suggestion chips should fill or submit common prompts.
- Desktop chat sidebar should collapse on tablet and mobile.
- Mobile chat should use the bottom composer pattern from the mockup, not a desktop-style input.
- Weather and freshness values must be real data when available. Do not show telemetry copy as decoration.
- Keep all text inside cards and buttons readable at mobile widths.
- Use stable dimensions for cards, chips, composer controls, and sidebars so hover/focus states do not shift layout.
- Avoid nested cards except where the mockup explicitly shows evidence cards inside assistant messages.

## Copy Rules

Use these exact primary strings unless product copy is intentionally revised:

- `Ask Siargao`
- `Ask Siargao anything about your trip.`
- `Local answers for where to stay, what to do, how to get around, and what today's weather changes.`
- `Weather-aware local answers for stays, food, beaches, transfers, parties, and practical help.`
- `Ask anything about your Siargao trip...`
- `Ask anything about Siargao...`
- `Live local data`
- `No booking bias`
- `Freshness + confidence shown`

Avoid these strings in the new implementation:

- `Start audit`
- `Trip risk audit`
- `Preview risk`
- `Sample report`
- `Check eligibility`
- `No charge until audit is completed`
- `Pay only if we can complete`
