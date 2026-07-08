import { z } from "zod";

import { type AgentToolFamily, defineTool } from "@/server/chat/agent-tool-catalogue";
import type { AnswerTrustLabel } from "@/server/chat/answer-source-summary";

type SourcePolicyDescription = {
  label: AnswerTrustLabel;
  meaning: string;
  useWhen: string;
  caveats: string[];
};

type SourcePolicyToolData = {
  policies: SourcePolicyDescription[];
};

const describeSourcePolicySchema = z.strictObject({});

const sourcePolicyDescriptions: SourcePolicyDescription[] = [
  {
    label: "live_checked",
    meaning: "A live Google Places lookup returned current allowed place fields.",
    useWhen:
      "Use for live Places search/detail outputs with allowed identity, rating, hours, price, contact, and map-link fields.",
    caveats: [
      "Use the result order as a shortlist, not a local quality ranking.",
      "Review text, bookings, table availability, room availability, and local quality checks were not checked.",
    ],
  },
  {
    label: "fresh_cache",
    meaning: "Fresh reusable Google Places cache rows backed the answer.",
    useWhen:
      "Use for cached Places facts that are still inside the configured freshness and retention windows.",
    caveats: [
      "Cached rows can be stale even when they are recent.",
      "Do not imply live open-now status unless that field was present and fresh.",
    ],
  },
  {
    label: "event_checked",
    meaning: "Approved nightlife event-source profiles backed event occurrence or schedule facts.",
    useWhen:
      "Use when search_nightlife_events returned fresh, unexpired General Luna nightlife event occurrences from approved event source profiles.",
    caveats: [
      "Google Places, review platforms, travel blogs, and community chatter are not event truth.",
      "Same-day facts expire after the event window and stale recurring baselines require refresh before being treated as current.",
    ],
  },
  {
    label: "no_current_event_facts",
    meaning:
      "The nightlife event tool ran, but approved current event facts did not match the requested local date.",
    useWhen:
      "Use as terminal event-source state only; combine with loaded NIGHTLIFE.md stable route memory when answering the traveler.",
    caveats: [
      "This is not a provider outage.",
      "Do not treat stable memory baselines as event_checked facts.",
      "Do not collapse party-route answers to weather-only advice when NIGHTLIFE.md contains a stable baseline route.",
    ],
  },
  {
    label: "venue_checked",
    meaning: "A governed venue-detail source backed venue identity or map-detail fields.",
    useWhen:
      "Use for venue identity, map links, address, business status, opening-hour signals, ratings, or review counts when a venue-detail tool returns those fields.",
    caveats: [
      "Venue checks do not verify tonight's event schedule, live crowd size, door policy, bookings, or table availability.",
    ],
  },
  {
    label: "web_researched",
    meaning:
      "A bounded public web research tool found useful source evidence for the requested public facts.",
    useWhen:
      "Use for research_web findings from accepted public source classes when the evidence is useful but not strictly official or directory-backed.",
    caveats: [
      "Do not use for raw model browsing or generic reasoning.",
      "Do not imply a live provider API check.",
      "The source class, freshness, and confidence still determine how strongly the answer can lean on the finding.",
    ],
  },
  {
    label: "official_checked",
    meaning: "An official public source was checked for the requested entity, status, or schedule.",
    useWhen:
      "Use for research_web findings from official venue, operator, government, event organizer, ferry company, resort, tour operator, or equivalent public sources.",
    caveats: [
      "Official pages can still be stale; preserve published, updated, or matched date context when available.",
      "Do not use for unofficial reposts, guides, reviews, or community chatter.",
    ],
  },
  {
    label: "directory_checked",
    meaning:
      "A local directory or event-calendar source was checked for the requested public fact.",
    useWhen:
      "Use for research_web findings from accepted Siargao directories, event calendars, or local business listings.",
    caveats: [
      "Directory evidence is usually weaker than official-source evidence for cancellations, closures, and one-off changes.",
      "Keep source confidence explicit when the directory row is recurring or undated.",
    ],
  },
  {
    label: "insufficient_web_evidence",
    meaning:
      "The web research tool ran, but did not find enough reliable current public evidence for the request.",
    useWhen:
      "Use as a terminal research_web state when search/fetch succeeds but the sources are too weak, stale, broad, or contradictory to answer as verified.",
    caveats: [
      "This is not positive evidence.",
      "Do not unlock broad Places, weather, or memory-only fallback answers when current public research was required.",
      "Render as not checked or a transparent caveat, not as a checked source claim.",
    ],
  },
  {
    label: "curated_local_guide",
    meaning: "Ask Siargao curated local guide data backed the answer.",
    useWhen: "Use for local beach and trip-planning facts maintained by Ask Siargao.",
    caveats: [
      "Tides, currents, road conditions, access changes, and lifeguard or safety status are not live checked.",
    ],
  },
  {
    label: "weather_checked",
    meaning: "Open-Meteo forecast data backed the weather or activity-planning answer.",
    useWhen: "Use when a usable live or stored Open-Meteo snapshot was available for the request.",
    caveats: [
      "Surf, swell, tides, road flooding, local closures, and provider-independent safety checks are not included.",
    ],
  },
  {
    label: "marine_checked",
    meaning:
      "Open-Meteo Marine model data backed tide-proxy sea level, wave, swell, or current context.",
    useWhen:
      "Use when get_marine_conditions or get_condition_judgment returned usable Open-Meteo Marine model data for the requested Siargao location.",
    caveats: [
      "This is modelled marine forecast data, not an official tide table, tide-gauge reading, navigation aid, or safety authority.",
      "Surf break quality, rip currents, lifeguards, local operator calls, and official marine warnings are not checked.",
    ],
  },
  {
    label: "tide_forecast_checked",
    meaning:
      "Tide-Forecast Dapa page data backed predicted tide times/heights and embedded 3-hour sea-condition timing.",
    useWhen:
      "Use when get_tide_forecast or get_condition_judgment returned usable Tide-Forecast Dapa page data for Siargao tide or surf timing.",
    caveats: [
      "This development/testing integration uses Tide-Forecast page data and production commercial use needs appropriate Tide-Forecast/Meteo365 permission or license.",
      "Dapa is a nearby station proxy for Cloud 9 and General Luna, not an exact break reading or safety clearance.",
      "Official tide-gauge measurements, navigation safety, rip currents, lifeguards, local operator calls, and official marine warnings are not checked.",
    ],
  },
  {
    label: "community_signal",
    meaning: "A low-confidence public community or broad travel signal was available.",
    useWhen:
      "Use only when a profiled, allowed public community/travel source is returned by a governed tool as context or discovery.",
    caveats: [
      "Community signals cannot rank venues or verify tonight's event schedule.",
      "Private or semi-private groups are disallowed unless explicitly submitted with permission through an approved profile.",
    ],
  },
  {
    label: "not_verified",
    meaning:
      "The answer uses generic model reasoning or stable context without a matching live/local tool output.",
    useWhen:
      "Use whenever no backend tool actually checked the specific live, cached, weather, or curated fact.",
    caveats: [
      "Never label generic model reasoning as live checked, fresh cache, weather checked, or curated local guide.",
    ],
  },
  {
    label: "provider_unavailable",
    meaning: "A provider or cache lookup needed for the answer failed or was unavailable.",
    useWhen:
      "Use when Google Places, Open-Meteo, or another backend provider could not return usable data.",
    caveats: [
      "Explain the missing check plainly and avoid fabricating provider-backed facts from model knowledge.",
    ],
  },
];

export function createSourcePolicyToolFamily(): AgentToolFamily {
  return {
    id: "source_policy",
    toolNames: ["describe_source_policy"],
    tools: {
      describe_source_policy: defineTool({
        definition: {
          type: "function",
          name: "describe_source_policy",
          description:
            "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: describeSourcePolicySchema,
        execute: () => ({
          name: "describe_source_policy",
          status: "success",
          text: renderSourcePolicyText(sourcePolicyDescriptions),
          data: {
            policies: sourcePolicyDescriptions,
          } satisfies SourcePolicyToolData,
          sources: [],
        }),
      }),
    },
  };
}

function renderSourcePolicyText(policies: readonly SourcePolicyDescription[]) {
  return [
    "Ask Siargao source policy labels:",
    ...policies.map(
      (policy) =>
        `- ${policy.label}: ${policy.meaning} Use when: ${policy.useWhen} Caveats: ${policy.caveats.join(" ")}`,
    ),
  ].join("\n");
}
