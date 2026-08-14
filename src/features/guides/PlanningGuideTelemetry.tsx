"use client";

import { useEffect } from "react";

import type { PlanningGuide } from "@/server/guides/planning-guides";

export type PlanningGuideRealityCheckAction =
  | "activity_replacement"
  | "hotel_location"
  | "no_scooter"
  | "weather";

type PlanningGuideTelemetryEvent =
  | {
      guideSlug: PlanningGuide["slug"];
      journeyId: string;
      name: "planning_guide_viewed";
      surface: "planning_guide";
    }
  | {
      action: PlanningGuideRealityCheckAction;
      guideSlug: PlanningGuide["slug"];
      journeyId: string;
      name: "planning_guide_reality_check_clicked";
      surface: "header" | "panel";
    };

export function PlanningGuideTelemetry({ guideSlug }: { guideSlug: PlanningGuide["slug"] }) {
  useEffect(() => {
    if (navigator.doNotTrack === "1") {
      return;
    }

    const guideRoot = document.getElementById("main-content");
    if (!guideRoot) {
      return;
    }

    const journeyId = crypto.randomUUID();
    sendPlanningGuideTelemetry({
      guideSlug,
      journeyId,
      name: "planning_guide_viewed",
      surface: "planning_guide",
    });

    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const link = event.target.closest<HTMLElement>("[data-reality-check-action]");
      if (!link || !guideRoot.contains(link)) {
        return;
      }

      const action = link.dataset.realityCheckAction;
      const surface = link.dataset.realityCheckSurface;
      if (!isRealityCheckAction(action) || (surface !== "header" && surface !== "panel")) {
        return;
      }

      sendPlanningGuideTelemetry({
        action,
        guideSlug,
        journeyId,
        name: "planning_guide_reality_check_clicked",
        surface,
      });
    };

    guideRoot.addEventListener("click", handleClick);
    return () => guideRoot.removeEventListener("click", handleClick);
  }, [guideSlug]);

  return null;
}

function sendPlanningGuideTelemetry(event: PlanningGuideTelemetryEvent) {
  void fetch("/api/observability/events", {
    body: JSON.stringify(event),
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}

function isRealityCheckAction(value: string | undefined): value is PlanningGuideRealityCheckAction {
  return (
    value === "activity_replacement" ||
    value === "hotel_location" ||
    value === "no_scooter" ||
    value === "weather"
  );
}
