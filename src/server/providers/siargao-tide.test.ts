import { describe, expect, test } from "bun:test";

import { buildSiargaoTideSnapshot } from "@/server/providers/siargao-tide";

describe("Siargao tide provider routing", () => {
  test("uses NOAA/PacIOOS in production even while Tide-Forecast stays off", async () => {
    let requestedUrl = "";
    const snapshot = await buildSiargaoTideSnapshot({
      dateRange: "today",
      env: { TIDE_FORECAST_MODE: "off", VERCEL_ENV: "production" },
      fetchedAt: new Date("2026-08-15T02:00:00Z"),
      fetcher: async (url) => {
        requestedUrl = String(url);
        return Response.json({
          table: {
            columnNames: ["time", "latitude", "longitude", "ssh"],
            rows: [
              ["2026-08-14T16:00:00Z", 10, 126, 0.2],
              ["2026-08-14T17:00:00Z", 10, 126, 0.8],
              ["2026-08-14T18:00:00Z", 10, 126, 0.1],
            ],
          },
        });
      },
      requestedLocation: "Cloud 9",
    });

    expect(requestedUrl).toContain("pacioos.hawaii.edu");
    expect(snapshot.sourceProfileId).toBe("source_pacioos_tide");
  });
});
