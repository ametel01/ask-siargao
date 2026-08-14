"use client";

import { useEffect, useRef } from "react";
import useSWRMutation from "swr/mutation";

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
  const journeyRef = useRef<{
    guideSlug: PlanningGuide["slug"];
    id: string;
    viewSent: boolean;
  } | null>(null);
  const { trigger: sendTelemetry } = useSWRMutation(
    "/api/observability/events",
    postPlanningGuideTelemetry,
  );

  useEffect(() => {
    if (navigator.doNotTrack === "1") {
      return;
    }

    const guideRoot = document.getElementById("main-content");
    if (!guideRoot) {
      return;
    }

    const journey =
      journeyRef.current?.guideSlug === guideSlug
        ? journeyRef.current
        : { guideSlug, id: crypto.randomUUID(), viewSent: false };
    journeyRef.current = journey;

    if (!journey.viewSent) {
      journey.viewSent = true;
      void sendTelemetry(
        {
          guideSlug,
          journeyId: journey.id,
          name: "planning_guide_viewed",
          surface: "planning_guide",
        },
        { throwOnError: false },
      );
    }

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

      void sendTelemetry(
        {
          action,
          guideSlug,
          journeyId: journey.id,
          name: "planning_guide_reality_check_clicked",
          surface,
        },
        { throwOnError: false },
      );
    };

    guideRoot.addEventListener("click", handleClick);
    return () => guideRoot.removeEventListener("click", handleClick);
  }, [guideSlug, sendTelemetry]);

  return null;
}

async function postPlanningGuideTelemetry(
  url: string,
  { arg: event }: { arg: PlanningGuideTelemetryEvent },
) {
  const response = await fetch(url, {
    body: JSON.stringify(event),
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Planning guide telemetry could not be recorded.");
  }
}

function isRealityCheckAction(value: string | undefined): value is PlanningGuideRealityCheckAction {
  return (
    value === "activity_replacement" ||
    value === "hotel_location" ||
    value === "no_scooter" ||
    value === "weather"
  );
}
