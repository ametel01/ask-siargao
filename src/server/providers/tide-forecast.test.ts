import { describe, expect, test } from "bun:test";

import {
  buildTideForecastSnapshot,
  parseTideForecastPage,
  tideForecastLocations,
  tideForecastSourceProfileId,
} from "@/server/providers/tide-forecast";

const fixtureHtml = `
<html>
  <body>
    <div class="live-conditions"
      data-first-period-start="1782680400"
      data-period-duration="10800"
      data-periods="[{&quot;weather_summary&quot;:&quot;clear&quot;,&quot;wind_speed&quot;:&quot;10.0&quot;,&quot;swell_height&quot;:&quot;0.7&quot;,&quot;swell_period&quot;:&quot;10&quot;,&quot;swell_direction&quot;:&quot;NE&quot;},{&quot;weather_summary&quot;:&quot;risk tstorm&quot;,&quot;wind_speed&quot;:&quot;15.0&quot;,&quot;swell_height&quot;:&quot;0.5&quot;,&quot;swell_period&quot;:&quot;8&quot;,&quot;swell_direction&quot;:&quot;ENE&quot;}]">
    </div>
    <script>
//<![CDATA[
window.FCGON = {"tideDays":[{"date":"2026-06-28","sunrise":1782595020,"sunset":1782640800,"tides":[{"timestamp":1782591300,"time":" 4:15AM","height":1.64,"type":"high"},{"timestamp":1782616260,"time":"11:11AM","height":0.27,"type":"low"}]},{"date":"2026-06-29","sunrise":1782681420,"sunset":1782727200,"tides":[{"timestamp":1782680100,"time":" 4:55AM","height":1.68,"type":"high"},{"timestamp":1782680400,"time":" 5:00AM","height":1.67,"type":null},{"timestamp":1782691200,"time":" 8:00AM","height":1.2,"type":null},{"timestamp":1782704880,"time":"11:48AM","height":0.21,"type":"low"},{"timestamp":1782728700,"time":" 6:25PM","height":1.49,"type":"high"},{"timestamp":1782747840,"time":"11:44PM","height":0.81,"type":"low"}]}],"serverTime":1782642450,"forecast_update_ts":1782654593,"maps":[{"lat":"9.7594","lng":"126.053","filename":"Dapa"}]};
//]]>
    </script>
  </body>
</html>
`;

describe("Tide-Forecast parser", () => {
  test("does not fetch the development-only page in production", async () => {
    let fetchCalls = 0;

    await expect(
      buildTideForecastSnapshot({
        dateRange: "today",
        env: { VERCEL_ENV: "production" },
        fetcher: async () => {
          fetchCalls += 1;
          return new Response(fixtureHtml);
        },
        requestedLocation: "Cloud 9",
      }),
    ).rejects.toThrow("tide_forecast_disabled");
    expect(fetchCalls).toBe(0);
  });

  test("extracts tomorrow tides, embedded sea periods, and recommended surf windows", () => {
    const snapshot = parseTideForecastPage({
      dateRange: "tomorrow",
      fetchedAt: "2026-06-28T10:00:00.000Z",
      html: fixtureHtml,
      location: tideForecastLocations.dapa,
      now: new Date("2026-06-28T10:00:00.000Z"),
      requestedLocation: "Cloud 9",
    });

    expect(snapshot.sourceProfileId).toBe(tideForecastSourceProfileId);
    expect(snapshot.targetDates).toEqual(["2026-06-29"]);
    expect(snapshot.stationName).toBe("Dapa tide station");
    expect(snapshot.stationLatitude).toBe(9.7594);
    expect(snapshot.days[0]?.tides.filter((tide) => tide.type)).toEqual([
      {
        heightMeters: 1.68,
        time: "4:55AM",
        timestamp: 1782680100,
        type: "high",
      },
      {
        heightMeters: 0.21,
        time: "11:48AM",
        timestamp: 1782704880,
        type: "low",
      },
      {
        heightMeters: 1.49,
        time: "6:25PM",
        timestamp: 1782728700,
        type: "high",
      },
      {
        heightMeters: 0.81,
        time: "11:44PM",
        timestamp: 1782747840,
        type: "low",
      },
    ]);
    expect(snapshot.seaPeriods).toHaveLength(2);
    expect(snapshot.seaPeriods[0]).toMatchObject({
      localLabel: "5:00 AM",
      swellHeightMeters: 0.7,
      swellPeriodSeconds: 10,
      windSpeedKmh: 10,
    });
    expect(snapshot.recommendedWindows[0]).toMatchObject({
      localLabel: "5:00 AM-8:00 AM",
      nearestTideType: "high",
      nearestTideTime: "4:55AM",
      swellHeightMeters: 0.7,
    });
    expect(snapshot.caveats.join(" ")).toContain("development/testing");
  });

  test("rejects pages without FCGON tide data", () => {
    expect(() =>
      parseTideForecastPage({
        dateRange: "today",
        fetchedAt: "2026-06-28T10:00:00.000Z",
        html: "<html></html>",
        now: new Date("2026-06-28T10:00:00.000Z"),
        requestedLocation: "Cloud 9",
      }),
    ).toThrow("window.FCGON");
  });
});
