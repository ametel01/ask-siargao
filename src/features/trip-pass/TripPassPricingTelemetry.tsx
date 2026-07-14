"use client";

import { useEffect } from "react";

export function TripPassPricingTelemetry() {
  useEffect(() => {
    if (navigator.doNotTrack === "1") {
      return;
    }

    const section = document.getElementById("trip-pass");
    if (!section) {
      return;
    }

    let sent = false;
    const send = () => {
      if (sent) {
        return;
      }
      sent = true;
      void fetch("/api/observability/events", {
        body: JSON.stringify({
          name: "trip_pass_pricing_viewed",
          surface: "landing",
        }),
        headers: { "content-type": "application/json" },
        keepalive: true,
        method: "POST",
      }).catch(() => undefined);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          send();
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(section);

    return () => observer.disconnect();
  }, []);

  return null;
}
