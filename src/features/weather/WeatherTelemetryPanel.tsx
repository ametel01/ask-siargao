"use client";

import { CloudRain, Droplets, Gauge, RefreshCw, Wind } from "lucide-react";
import { startTransition, useEffect, useState } from "react";

import type { WeatherRiskMetric, WeatherSnapshot } from "@/server/public-pages/weather-snapshot";
import { css } from "../../../styled-system/css/css";
import { cx } from "../../../styled-system/css/cx";
import { sectionPanel } from "../../../styled-system/recipes/section-panel";

type WeatherApiResponse = {
  weather: WeatherSnapshot;
};

const metricIcons: Record<WeatherRiskMetric["id"], typeof CloudRain> = {
  precipitation_probability: CloudRain,
  rain_sum: Droplets,
  wind_gust: Wind,
};

const levelCopy: Record<WeatherRiskMetric["level"], string> = {
  low: "Watch",
  medium: "Buffer",
  high: "Plan B",
};

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
        const response = await fetch("/api/public/weather/siargao", {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const body = (await response.json()) as WeatherApiResponse;
        startTransition(() => setSnapshot(body.weather));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Weather telemetry refresh failed.", error);
        }
      }
    }

    refreshWeather();

    return () => controller.abort();
  }, []);

  const isLive = snapshot.status === "live";

  return (
    <section
      aria-labelledby="weather-telemetry-title"
      className={cx(
        sectionPanel(),
        css({
          isolation: "isolate",
          mt: "4",
          overflow: "hidden",
          position: "relative",
        }),
      )}
      id="weather"
    >
      <div
        aria-hidden="true"
        className={css({
          background:
            "radial-gradient(circle at 18% 18%, rgba(121, 214, 255, 0.34), transparent 28%), radial-gradient(circle at 86% 12%, rgba(255, 212, 103, 0.22), transparent 30%), linear-gradient(135deg, rgba(5, 21, 44, 0.96), rgba(15, 73, 96, 0.86))",
          inset: 0,
          position: "absolute",
          zIndex: -2,
        })}
      />
      <div
        aria-hidden="true"
        className={css({
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          inset: 0,
          opacity: 0.36,
          position: "absolute",
          zIndex: -1,
        })}
      />

      <div
        className={css({
          display: "grid",
          gap: { base: "5", lg: "8" },
          gridTemplateColumns: { base: "1fr", lg: "0.78fr 1.22fr" },
          p: { base: "5", md: "6" },
        })}
      >
        <div className={css({ color: "text.onDark", display: "grid", gap: "4" })}>
          <span
            className={css({
              alignItems: "center",
              bg: isLive ? "rgba(123, 232, 188, 0.14)" : "rgba(255,255,255,0.12)",
              borderColor: isLive ? "rgba(123, 232, 188, 0.48)" : "rgba(255,255,255,0.22)",
              borderRadius: "pill",
              borderWidth: "1px",
              display: "inline-flex",
              fontSize: "xs",
              fontWeight: "800",
              gap: "2",
              justifySelf: "start",
              minH: "30px",
              px: "3",
              textTransform: "uppercase",
            })}
          >
            <RefreshCw aria-hidden="true" size={14} />
            {isLive ? "Live forecast loaded" : "Waiting for first ingest"}
          </span>
          <div>
            <p
              className={css({
                color: "rgba(228, 247, 255, 0.72)",
                fontSize: "xs",
                fontWeight: "800",
                letterSpacing: "0.16em",
                mb: "3",
                textTransform: "uppercase",
              })}
            >
              Weather telemetry
            </p>
            <h2
              className={css({
                fontSize: { base: "2xl", md: "3xl" },
                fontWeight: "800",
                lineHeight: "1.08",
                m: 0,
                maxW: "520px",
              })}
              id="weather-telemetry-title"
            >
              Forecast facts now enter the audit as evidence, not decoration.
            </h2>
          </div>
          <p
            className={css({
              color: "rgba(228, 247, 255, 0.78)",
              fontSize: "sm",
              lineHeight: "1.7",
              m: 0,
              maxW: "560px",
            })}
          >
            {snapshot.summary}
          </p>
          <dl
            className={css({
              display: "grid",
              gap: "3",
              gridTemplateColumns: { base: "1fr", sm: "repeat(3, 1fr)" },
              m: 0,
            })}
          >
            <WeatherMeta label="Freshness" value={snapshot.freshness} />
            <WeatherMeta label="Confidence" value={snapshot.confidence} />
            <WeatherMeta label="Fetched" value={formatDate(snapshot.fetchedAt)} />
          </dl>
        </div>

        <div
          className={css({
            bg: "rgba(250, 253, 247, 0.92)",
            borderColor: "rgba(255,255,255,0.42)",
            borderRadius: "xl",
            borderWidth: "1px",
            boxShadow: "0 28px 80px rgba(0, 0, 0, 0.28)",
            display: "grid",
            gap: "4",
            p: { base: "4", md: "5" },
          })}
        >
          <div
            className={css({
              alignItems: "start",
              display: "flex",
              gap: "4",
              justifyContent: "space-between",
            })}
          >
            <div>
              <p className={weatherEyebrow()}>Source</p>
              <h3
                className={css({
                  color: "text.strong",
                  fontSize: "lg",
                  fontWeight: "800",
                  lineHeight: "1.2",
                  m: 0,
                })}
              >
                {snapshot.sourceName}
              </h3>
              <p className={css({ color: "text.muted", fontSize: "xs", m: 0, mt: "1" })}>
                {snapshot.locationName}
              </p>
            </div>
            <span
              className={css({
                alignItems: "center",
                bg: snapshot.freshness === "fresh" ? "rgba(26, 141, 100, 0.12)" : "surface.tint",
                borderColor: snapshot.freshness === "fresh" ? "rgba(26, 141, 100, 0.28)" : "border",
                borderRadius: "pill",
                borderWidth: "1px",
                color: snapshot.freshness === "fresh" ? "risk.lowDark" : "text.muted",
                display: "inline-flex",
                fontSize: "2xs",
                fontWeight: "800",
                gap: "2",
                minH: "28px",
                px: "3",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              })}
            >
              <Gauge aria-hidden="true" size={14} />
              {snapshot.status}
            </span>
          </div>

          <div
            className={css({
              display: "grid",
              gap: "3",
              gridTemplateColumns: { base: "1fr", md: "repeat(3, 1fr)" },
            })}
          >
            {snapshot.metrics.map((metric) => (
              <WeatherMetricCard key={metric.id} metric={metric} />
            ))}
          </div>

          <p
            className={css({
              borderTopColor: "border",
              borderTopWidth: "1px",
              color: "text.soft",
              fontSize: "2xs",
              lineHeight: "1.55",
              m: 0,
              pt: "3",
            })}
          >
            Evidence IDs: {snapshot.evidenceIds.join(", ")}.{" "}
            {snapshot.expiresAt
              ? `Refresh before ${formatDate(snapshot.expiresAt)} if weather is critical.`
              : "Run ingestion to replace this fallback with live forecast evidence."}
          </p>
        </div>
      </div>
    </section>
  );
}

function WeatherMetricCard({ metric }: { metric: WeatherRiskMetric }) {
  const Icon = metricIcons[metric.id];

  return (
    <article
      className={css({
        bg:
          metric.level === "high"
            ? "rgba(255, 232, 221, 0.92)"
            : metric.level === "medium"
              ? "rgba(255, 247, 220, 0.92)"
              : "rgba(230, 249, 240, 0.92)",
        borderColor:
          metric.level === "high"
            ? "rgba(201, 78, 55, 0.28)"
            : metric.level === "medium"
              ? "rgba(185, 127, 25, 0.28)"
              : "rgba(26, 141, 100, 0.22)",
        borderRadius: "lg",
        borderWidth: "1px",
        display: "grid",
        gap: "3",
        minH: "184px",
        overflow: "hidden",
        p: "4",
        position: "relative",
      })}
    >
      <div
        aria-hidden="true"
        className={css({
          borderColor: "rgba(255,255,255,0.7)",
          borderRadius: "999px",
          borderWidth: "18px",
          h: "96px",
          position: "absolute",
          right: "-34px",
          top: "-34px",
          width: "96px",
        })}
      />
      <div
        className={css({
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          position: "relative",
        })}
      >
        <span
          className={css({
            alignItems: "center",
            bg: "rgba(255,255,255,0.74)",
            borderRadius: "md",
            color:
              metric.level === "high"
                ? "risk.high"
                : metric.level === "medium"
                  ? "risk.medium"
                  : "risk.lowDark",
            display: "inline-flex",
            h: "10",
            justifyContent: "center",
            width: "10",
          })}
        >
          <Icon aria-hidden="true" size={21} />
        </span>
        <span
          className={css({
            color:
              metric.level === "high"
                ? "risk.high"
                : metric.level === "medium"
                  ? "risk.medium"
                  : "risk.lowDark",
            fontSize: "2xs",
            fontWeight: "900",
            textTransform: "uppercase",
          })}
        >
          {levelCopy[metric.level]}
        </span>
      </div>
      <div className={css({ position: "relative" })}>
        <p className={weatherEyebrow()}>{metric.label}</p>
        <strong
          className={css({
            color: "text.strong",
            display: "block",
            fontSize: { base: "3xl", md: "2xl", lg: "3xl" },
            letterSpacing: "-0.04em",
            lineHeight: "0.95",
          })}
        >
          {metric.value}
          <span className={css({ fontSize: "sm", letterSpacing: 0, ml: "1" })}>{metric.unit}</span>
        </strong>
        <p className={css({ color: "text.muted", fontSize: "xs", lineHeight: "1.45", mb: 0 })}>
          Peak date: {metric.peakDate}
        </p>
      </div>
    </article>
  );
}

function WeatherMeta({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={css({
        bg: "rgba(255,255,255,0.1)",
        borderColor: "rgba(255,255,255,0.16)",
        borderRadius: "lg",
        borderWidth: "1px",
        p: "3",
      })}
    >
      <dt
        className={css({
          color: "rgba(228, 247, 255, 0.62)",
          fontSize: "2xs",
          fontWeight: "800",
          textTransform: "uppercase",
        })}
      >
        {label}
      </dt>
      <dd className={css({ color: "text.onDark", fontSize: "sm", fontWeight: "800", m: 0 })}>
        {value}
      </dd>
    </div>
  );
}

function weatherEyebrow() {
  return css({
    color: "text.soft",
    fontSize: "2xs",
    fontWeight: "900",
    letterSpacing: "0.08em",
    mb: "2",
    mt: 0,
    textTransform: "uppercase",
  });
}

function formatDate(value: string) {
  if (value === "pending") {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}
