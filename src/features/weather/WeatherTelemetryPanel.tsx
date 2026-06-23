"use client";

import { CloudSun, Compass, Droplets, RefreshCw, Umbrella, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { startTransition, useEffect, useState } from "react";

import type { WeatherSnapshot, WeatherTodayForecast } from "@/server/public-pages/weather-snapshot";
import { css } from "../../../styled-system/css/css";

type WeatherApiResponse = {
  weather: WeatherSnapshot;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Manila",
  weekday: "short",
});

const updateFormatter = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "Asia/Manila",
});

async function fetchWeatherSnapshot(signal: AbortSignal) {
  const response = await fetch("/api/public/weather/siargao", {
    headers: { accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as WeatherApiResponse;
  return body.weather;
}

export function WeatherTelemetryPanel({
  initialSnapshot,
}: {
  initialSnapshot: WeatherSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    const controller = new AbortController();

    async function refreshWeather() {
      try {
        const weather = await fetchWeatherSnapshot(controller.signal);
        if (!weather) {
          return;
        }

        startTransition(() => setSnapshot(weather));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Weather telemetry refresh failed.", error);
        }
      }
    }

    refreshWeather();

    return () => controller.abort();
  }, []);

  return (
    <section
      aria-labelledby="weather-telemetry-title"
      className={css({
        bg: "rgba(255,255,255,0.94)",
        borderColor: "rgba(255,255,255,0.72)",
        borderRadius: "lg",
        borderWidth: "1px",
        boxShadow: "0 24px 70px rgba(0,0,0,0.2)",
        color: "text",
        maxW: "1220px",
        mx: "auto",
        overflow: "hidden",
      })}
      id="weather"
    >
      <div
        className={css({
          alignItems: "stretch",
          display: "grid",
          gridTemplateColumns: { base: "1fr", lg: "0.92fr 1.36fr 0.72fr" },
        })}
      >
        <ForecastLead snapshot={snapshot} />
        <ForecastMetrics today={snapshot.today} />
        <ForecastSource snapshot={snapshot} />
      </div>
    </section>
  );
}

function ForecastLead({ snapshot }: { snapshot: WeatherSnapshot }) {
  const today = snapshot.today;
  const levelTone = levelColor(today.level);

  return (
    <div
      className={css({
        background:
          "linear-gradient(135deg, rgba(7, 10, 45, 0.94), rgba(36, 24, 105, 0.88)), url('/images/siargao-sunset.png') center / cover",
        color: "text.onDark",
        display: "grid",
        gap: "4",
        p: { base: "5", md: "6" },
      })}
    >
      <div>
        <p className={eyebrow({ color: "rgba(255,255,255,0.66)" })}>Today in Siargao</p>
        <h2
          className={css({
            color: "text.onDark",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: { base: "2xl", md: "3xl" },
            fontWeight: "800",
            lineHeight: "1.05",
            m: 0,
          })}
          id="weather-telemetry-title"
        >
          {today.condition}
        </h2>
        <p className={css({ color: "text.onDarkMuted", fontSize: "sm", m: 0, mt: "2" })}>
          {formatForecastDate(today.date)} forecast near General Luna
        </p>
      </div>
      <div
        className={css({
          alignItems: "center",
          display: "flex",
          gap: "3",
        })}
      >
        <span
          className={css({
            alignItems: "center",
            bg: "rgba(255,255,255,0.14)",
            borderColor: "rgba(255,255,255,0.22)",
            borderRadius: "pill",
            borderWidth: "1px",
            color: levelTone,
            display: "inline-flex",
            fontSize: "xs",
            fontWeight: "900",
            gap: "2",
            minH: "34px",
            px: "3",
            textTransform: "uppercase",
          })}
        >
          <CloudSun aria-hidden="true" size={16} />
          {today.level} weather risk
        </span>
      </div>
    </div>
  );
}

function ForecastMetrics({ today }: { today: WeatherTodayForecast }) {
  return (
    <div
      className={css({
        display: "grid",
        gap: "3",
        gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
        p: { base: "5", md: "6" },
      })}
    >
      <Metric
        icon={Umbrella}
        label="Rain chance"
        tone={
          today.precipitationProbability !== null && today.precipitationProbability >= 75
            ? "warn"
            : "normal"
        }
        value={formatValue(today.precipitationProbability, "%")}
      />
      <Metric icon={Droplets} label="Rain total" value={formatValue(today.rainSum, "mm")} />
      <Metric icon={Wind} label="Wind gust" value={formatValue(today.windGust, "km/h")} />
      <Metric icon={Compass} label="Wind max" value={formatValue(today.windSpeed, "km/h")} />
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  tone = "normal",
  value,
}: {
  icon: LucideIcon;
  label: string;
  tone?: "normal" | "warn";
  value: string;
}) {
  return (
    <article
      className={css({
        bg: tone === "warn" ? "rgba(255, 248, 225, 0.9)" : "surface.soft",
        borderColor: tone === "warn" ? "rgba(230, 169, 40, 0.34)" : "border",
        borderRadius: "md",
        borderWidth: "1px",
        minH: "112px",
        p: "4",
      })}
    >
      <Icon
        aria-hidden="true"
        className={css({ color: tone === "warn" ? "risk.medium" : "violet.600", mb: "3" })}
        size={22}
      />
      <strong
        className={css({
          color: "text.strong",
          display: "block",
          fontSize: "xl",
          fontWeight: "900",
          lineHeight: "1",
        })}
      >
        {value}
      </strong>
      <span className={css({ color: "text.muted", display: "block", fontSize: "xs", mt: "2" })}>
        {label}
      </span>
    </article>
  );
}

function ForecastSource({ snapshot }: { snapshot: WeatherSnapshot }) {
  return (
    <div
      className={css({
        borderLeftColor: "border",
        borderLeftWidth: { base: "0", lg: "1px" },
        borderTopColor: "border",
        borderTopWidth: { base: "1px", lg: "0" },
        display: "grid",
        gap: "3",
        p: { base: "5", md: "6" },
      })}
    >
      <p className={eyebrow({ color: "text.soft" })}>Source</p>
      <strong className={css({ color: "text.strong", fontSize: "sm", lineHeight: "1.35" })}>
        {snapshot.sourceName}
      </strong>
      <span className={css({ color: "text.muted", fontSize: "xs", lineHeight: "1.55" })}>
        Updated {formatUpdateDate(snapshot.fetchedAt)}. Evidence: {snapshot.today.evidenceId}.
      </span>
      <span
        className={css({
          alignItems: "center",
          color: snapshot.freshness === "fresh" ? "risk.lowDark" : "risk.medium",
          display: "inline-flex",
          fontSize: "xs",
          fontWeight: "900",
          gap: "2",
          textTransform: "uppercase",
        })}
      >
        <RefreshCw aria-hidden="true" size={14} />
        {snapshot.freshness}
      </span>
    </div>
  );
}

function eyebrow({ color }: { color: string }) {
  return css({
    color,
    fontSize: "2xs",
    fontWeight: "900",
    letterSpacing: "0.08em",
    m: 0,
    textTransform: "uppercase",
  });
}

function formatValue(value: number | null, unit: string) {
  return value === null ? "--" : `${Math.round(value)}${unit}`;
}

function formatForecastDate(value: string) {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return dateFormatter.format(date);
}

function formatUpdateDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return updateFormatter.format(date);
}

function levelColor(level: WeatherTodayForecast["level"]) {
  if (level === "high") {
    return "#ff9a9f";
  }
  if (level === "medium") {
    return "#ffd36b";
  }
  return "#93e68e";
}
