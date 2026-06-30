import { describe, expect, test } from "bun:test";

import type { AgentRuntimeRequest, AgentToolCallAudit } from "@/server/chat/agent-runtime";
import {
  buildRequiredEvidencePlan,
  missingRequiredEvidenceToolCalls,
} from "@/server/chat/required-evidence";

describe("required evidence planning", () => {
  test("requires web research before nightlife, Places, and weather enrichment", () => {
    const plan = buildRequiredEvidencePlan(
      requestWithIntent({
        latestUserTurn: "what are the best party locations in General Luna today?",
        nightlifePlan: true,
        today: true,
        weatherSensitive: true,
        locationLabel: "General Luna",
        placeIntent: {
          category: "bar",
          liveNeeds: ["recommendation"],
          location: "General Luna",
        },
        researchIntent: researchIntent({
          query: "what are the best party locations in General Luna today?",
          intent: "recommendation",
          location: "General Luna",
          dateContext: "today",
          sourceTypes: ["official", "local_directory", "social", "guide", "community"],
          requiredFreshness: "same_day",
        }),
      }),
    );

    expect(plan.requiredToolCalls.map((call) => call.name)).toEqual([
      "research_web",
      "search_nightlife_events",
      "search_places",
      "get_weather_forecast",
    ]);
    expect(plan.requiredToolCalls[0]).toMatchObject({
      name: "research_web",
      purpose: "current_public_web_research",
      acceptedSourceLabels: [
        "official_checked",
        "directory_checked",
        "web_researched",
        "community_signal",
      ],
      terminalSourceLabels: ["insufficient_web_evidence", "provider_unavailable"],
      runBefore: ["search_places", "get_weather_forecast", "search_nightlife_events"],
    });
    expect(plan.requiredToolCalls[1]).toMatchObject({ dependsOn: ["research_web"] });
    expect(plan.requiredToolCalls[2]).toMatchObject({
      dependsOn: ["research_web", "search_nightlife_events"],
    });
  });

  test("requires web research before current restaurant recommendation Places enrichment", () => {
    const plan = buildRequiredEvidencePlan(
      requestWithIntent({
        latestUserTurn: "best dinner in General Luna tonight",
        today: true,
        locationLabel: "General Luna",
        placeIntent: {
          category: "food",
          liveNeeds: ["recommendation", "open_now"],
          meal: "dinner",
          location: "General Luna",
        },
        researchIntent: researchIntent({
          query: "best dinner in General Luna tonight",
          intent: "recommendation",
          location: "General Luna",
          dateContext: "tonight",
          sourceTypes: ["maps", "official", "local_directory", "guide", "social"],
          requiredFreshness: "same_day",
        }),
      }),
    );

    expect(plan.requiredToolCalls.map((call) => call.name)).toEqual([
      "research_web",
      "search_places",
    ]);
    expect(plan.requiredToolCalls[1]).toMatchObject({
      name: "search_places",
      dependsOn: ["research_web"],
      requiresOpenNow: true,
    });
    expect(missingRequiredEvidenceToolCalls(plan, [])).toEqual([plan.requiredToolCalls[0]]);
    expect(missingRequiredEvidenceToolCalls(plan, [successfulResearchToolCall()])).toEqual([
      plan.requiredToolCalls[1],
    ]);
  });

  test("requires web research for ferry schedules, tour prices, and safety disruptions", () => {
    for (const scenario of [
      {
        query: "Dapa to Surigao ferry schedule tomorrow",
        intent: "schedule",
        dateContext: "tomorrow",
        requiredFreshness: "same_day",
      },
      {
        query: "how much is a Sugba Lagoon tour right now?",
        intent: "price",
        dateContext: "today",
        requiredFreshness: "week",
      },
      {
        query: "any road closures or brownout advisories in Siargao today?",
        intent: "safety",
        dateContext: "today",
        requiredFreshness: "same_day",
      },
    ]) {
      const plan = buildRequiredEvidencePlan(
        requestWithIntent({
          latestUserTurn: scenario.query,
          today: true,
          locationLabel: "Siargao Island",
          researchIntent: researchIntent({
            query: scenario.query,
            intent: scenario.intent,
            location: "Siargao Island",
            dateContext: scenario.dateContext,
            requiredFreshness: scenario.requiredFreshness,
          }),
        }),
      );

      expect(plan.requiredToolCalls).toHaveLength(1);
      expect(plan.requiredToolCalls[0]).toMatchObject({
        name: "research_web",
        arguments: {
          query: scenario.query,
          intent: scenario.intent,
          dateContext: scenario.dateContext,
          requiredFreshness: scenario.requiredFreshness,
        },
      });
    }
  });

  test("does not require research for stable local-guide prompts without current status", () => {
    const plan = buildRequiredEvidencePlan(
      requestWithIntent({
        latestUserTurn: "best sandy beach near General Luna for swimming",
        beach: true,
        locationLabel: "General Luna",
      }),
    );

    expect(plan.requiredToolCalls.map((call) => call.name)).not.toContain("research_web");
  });

  test("treats insufficient web evidence as completed but not satisfying checked evidence", () => {
    const plan = buildRequiredEvidencePlan(
      requestWithIntent({
        latestUserTurn: "ferry cancellations today",
        today: true,
        researchIntent: researchIntent({
          query: "ferry cancellations today",
          intent: "safety",
          dateContext: "today",
          requiredFreshness: "same_day",
        }),
      }),
    );
    const toolCalls = [
      toolCall({
        name: "research_web",
        sources: [
          {
            label: "insufficient_web_evidence",
            sourceName: "Public web research",
            sourceProfileId: "source_web_research",
            confidence: "low",
            checked: [],
            notChecked: ["current ferry disruption evidence"],
          },
        ],
      }),
    ];

    expect(missingRequiredEvidenceToolCalls(plan, toolCalls)).toEqual([]);
  });
});

function requestWithIntent(intent: Record<string, unknown>): AgentRuntimeRequest {
  return {
    requestId: "request_required_evidence",
    messages: [{ role: "user", content: String(intent.latestUserTurn ?? "Siargao question") }],
    deterministicSignals: { intent },
  };
}

function researchIntent(fields: Record<string, unknown>) {
  return {
    required: true,
    sourceTypes: ["official", "local_directory", "guide"],
    ...fields,
  };
}

function toolCall({
  name,
  sources,
}: {
  name: string;
  sources: AgentToolCallAudit["sources"];
}): AgentToolCallAudit {
  return {
    id: `audit_${name}`,
    name,
    arguments: {},
    status: "success",
    durationMs: 1,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T00:00:00.001Z",
    sourceProfileIds: sources.flatMap((source) =>
      source.sourceProfileId ? [source.sourceProfileId] : [],
    ),
    sources,
  };
}

function successfulResearchToolCall() {
  return toolCall({
    name: "research_web",
    sources: [
      {
        label: "official_checked",
        sourceName: "Official dinner source",
        sourceProfileId: "source_web_official",
        confidence: "high",
        checked: ["current dinner hours"],
        notChecked: ["bookings"],
      },
    ],
  });
}
