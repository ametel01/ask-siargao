# Planning Guide Analytics

Planning guide analytics measure the public-guide journey from a guide view to a Reality Check
handoff. They are aggregate product evidence only; they do not carry chat prompts, message text,
account identity, or precise location.

## Browser and API flow

`PlanningGuideTelemetry` creates a fresh, non-persisted UUID for each mounted guide visit and sends
events through `POST /api/observability/events`. The browser does not send events when
`navigator.doNotTrack` is `1`. Reality Check links expose only a stable action key and a coarse
`header` or `panel` surface.

The API accepts only published planning-guide slugs, UUID visit identifiers, the four registered
action keys, and their exact surfaces. It converts the UUID to a pseudonymous PostHog distinct ID,
then removes it from event properties. The shared analytics allowlist and prohibited-key filter run
before delivery.

## Event matrix

| Event | Source | Safe properties |
| --- | --- | --- |
| `planning_guide_viewed` | Published planning guide | `guideSlug`, `status=viewed`, `surface=planning_guide` |
| `planning_guide_reality_check_clicked` | Header or Reality Check panel link | `action`, `guideSlug`, `status=clicked`, `surface` |

The registered action values are `weather`, `no_scooter`, `hotel_location`, and
`activity_replacement`. Labels and prompts may change without changing the analytics contract.

## PostHog views

The `Analytics basics (wizard)` dashboard contains:

- the ordered `planning_guide_viewed` to `planning_guide_reality_check_clicked` funnel;
- daily guide views broken down by `guideSlug`; and
- daily Reality Check clicks broken down by `action`.

Production delivery remains fail-open for the product: missing PostHog configuration or an ingest
timeout is logged and never blocks guide navigation. PostHog production enablement must continue to
meet the retention, privacy, and data-category controls in the production vendor register.
