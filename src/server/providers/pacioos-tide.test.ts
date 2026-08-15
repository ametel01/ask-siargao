import { describe, expect, test } from "bun:test";

import {
  buildPacioosTideQueryUrl,
  buildPacioosTideSnapshot,
} from "@/server/providers/pacioos-tide";

const rows = [
  ["2026-08-14T15:00:00Z", 10, 126, 0.2],
  ["2026-08-14T16:00:00Z", 10, 126, 0.6],
  ["2026-08-14T17:00:00Z", 10, 126, 1.1],
  ["2026-08-14T18:00:00Z", 10, 126, 0.7],
  ["2026-08-14T22:00:00Z", 10, 126, -0.4],
  ["2026-08-14T23:00:00Z", 10, 126, -0.9],
  ["2026-08-15T00:00:00Z", 10, 126, -0.5],
  ["2026-08-15T05:00:00Z", 10, 126, 0.5],
  ["2026-08-15T06:00:00Z", 10, 126, 0.9],
  ["2026-08-15T07:00:00Z", 10, 126, 0.4],
  ["2026-08-15T14:00:00Z", 10, 126, -0.8],
  ["2026-08-15T15:00:00Z", 10, 126, -0.3],
  ["2026-08-15T16:00:00Z", 10, 126, 0.1],
];

describe("NOAA/PacIOOS modeled tide provider", () => {
  test("queries the public-domain Pacific tide grid with date padding", () => {
    const url = buildPacioosTideQueryUrl({
      dateRange: "today",
      location: { latitude: 9.784, longitude: 126.158 },
      now: new Date("2026-08-15T02:00:00Z"),
    });

    expect(url).toContain("/erddap/griddap/tide_pac.json?");
    expect(decodeURIComponent(url)).toContain("ssh[(2026-08-14T15:00:00Z)");
    expect(decodeURIComponent(url)).toContain("[(9.784):1:(9.784)]");
  });

  test("extracts modeled high and low events for the Manila-local day", async () => {
    const snapshot = await buildPacioosTideSnapshot({
      dateRange: "today",
      fetchedAt: new Date("2026-08-15T02:00:00Z"),
      fetcher: async () =>
        Response.json({
          table: {
            columnNames: ["time", "latitude", "longitude", "ssh"],
            rows,
          },
        }),
      requestedLocation: "Cloud 9",
    });

    expect(snapshot).toMatchObject({
      status: "live",
      sourceName: "NOAA/PacIOOS Pacific tide model",
      sourceProfileId: "source_pacioos_tide",
      stationLatitude: 10,
      stationLongitude: 126,
      requestedLocation: "Cloud 9",
      targetDates: ["2026-08-15"],
    });
    expect(snapshot.days[0]?.tides).toEqual([
      expect.objectContaining({ type: "high", heightMeters: 1.1, time: "1:00 AM" }),
      expect.objectContaining({ type: "low", heightMeters: -0.9, time: "7:00 AM" }),
      expect.objectContaining({ type: "high", heightMeters: 0.9, time: "2:00 PM" }),
      expect.objectContaining({ type: "low", heightMeters: -0.8, time: "10:00 PM" }),
    ]);
    expect(snapshot.recommendedWindows.length).toBeGreaterThan(0);
    expect(snapshot.caveats.join(" ")).toContain("2-degree");
    expect(snapshot.caveats.join(" ")).toContain("not a safety clearance");
    expect(snapshot.caveats.join(" ")).toContain("public-domain");
  });

  test("fails closed when the model returns no usable grid rows", async () => {
    await expect(
      buildPacioosTideSnapshot({
        dateRange: "today",
        fetcher: async () =>
          Response.json({
            table: { columnNames: ["time", "latitude", "longitude", "ssh"], rows: [] },
          }),
        requestedLocation: "Cloud 9",
      }),
    ).rejects.toThrow("PacIOOS");
  });
});
