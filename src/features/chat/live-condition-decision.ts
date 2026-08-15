export type ConditionDecisionState =
  | "loading"
  | "live"
  | "partial"
  | "stale"
  | "unavailable"
  | "not-verified";

export type ConditionSupportingMetric = {
  label: string;
  value: string;
};

export type LiveConditionDecision = {
  kind: "weather" | "surf";
  state: ConditionDecisionState;
  action: string;
  basis: string;
  fallback: string;
  timing?: string;
  evidenceStatus?: string;
  sourceTime?: string;
  supportingMetrics: ConditionSupportingMetric[];
  checked: string[];
  notChecked: string[];
  isPrior: boolean;
};

export type WeatherConditionSnapshot = {
  status: "live" | "fallback";
  locationName: string;
  fetchedAt: string;
  freshness: "fresh" | "stale" | "unknown";
  today: {
    condition: string;
    precipitationProbability: number | null;
    rainSum: number | null;
    precipitationSum: number | null;
    windGust: number | null;
    windSpeed?: number | null;
  };
};

export type SurfConditionSnapshot = {
  status: "live" | "partial" | "unavailable";
  locationName: string;
  fetchedAt: string;
  level: "low" | "medium" | "high";
  metrics: {
    waves: string;
    tide: string;
    wind: string;
  };
  weather: {
    status: "live" | "fallback" | "unavailable";
    freshness: "fresh" | "stale" | "unknown";
    condition: string;
    precipitationProbability: number | null;
    rainSum: number | null;
    windGust: number | null;
  };
  tide: {
    status: "live" | "unavailable";
    stationName: string;
    bestWindow: string | null;
  };
  caveats: string[];
};

type DecisionRequest<TSnapshot> = {
  locationName: string;
  snapshot: TSnapshot | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  hasError: boolean;
};

export type ConditionDecisionSummaryFields = {
  bestAction: string;
  basis: string;
  fallback: string;
  timing?: string;
};

const weatherBoundaries = [
  "Road flooding, closures, and official warnings were not checked.",
  "This forecast is not a transport or safety clearance.",
];

const surfBoundaries = [
  "Road access, official marine warnings, and safety status were not checked.",
  "Exact-break conditions, rip currents, lifeguard status, and local operator confirmation were not checked.",
];

export function projectWeatherConditionDecision(
  request: DecisionRequest<WeatherConditionSnapshot>,
): LiveConditionDecision {
  const metrics = weatherMetrics(request.snapshot);
  const snapshot = request.snapshot;

  if (request.isLoading && !snapshot) {
    return loadingDecision("weather", metrics, "Checking the weather forecast.");
  }
  if (request.hasError && !snapshot) {
    return unavailableWeatherDecision(metrics, "The weather forecast could not be checked.");
  }
  if (!snapshot || snapshot.status === "fallback") {
    return unavailableWeatherDecision(metrics, "No current weather forecast is available.");
  }
  if (request.hasError || request.isRefreshing || snapshot.freshness === "stale") {
    return {
      kind: "weather",
      state: "stale",
      action: "Keep the outdoor plan flexible.",
      basis: request.hasError
        ? "The latest refresh failed, so these are prior forecast signals."
        : "These forecast signals are prior data and may no longer reflect current conditions.",
      fallback:
        "Keep a covered stop ready and recheck the forecast before committing to an exposed plan.",
      evidenceStatus: "Forecast freshness: stale",
      sourceTime: snapshot.fetchedAt,
      supportingMetrics: metrics,
      checked: ["Prior Open-Meteo daily forecast signals"],
      notChecked: weatherBoundaries,
      isPrior: true,
    };
  }
  if (snapshot.freshness === "unknown") {
    return {
      kind: "weather",
      state: "not-verified",
      action: "Keep the outdoor plan flexible.",
      basis: "Forecast values are available, but their current freshness is not confirmed.",
      fallback: "Keep a covered stop ready and recheck before relying on the forecast.",
      evidenceStatus: "Forecast freshness: unknown",
      sourceTime: snapshot.fetchedAt,
      supportingMetrics: metrics,
      checked: ["Open-Meteo daily forecast values"],
      notChecked: weatherBoundaries,
      isPrior: false,
    };
  }

  const level = weatherLevel(snapshot);
  const details = weatherDetails(snapshot);
  const action =
    level === "high"
      ? "Avoid an exposed plan; choose cover."
      : level === "medium"
        ? "Choose cover and keep the plan flexible."
        : "Keep the outdoor plan flexible.";
  const fallback =
    level === "high"
      ? "Switch to a covered stop and recheck the forecast before changing plans."
      : "Keep a covered stop ready if the forecast changes.";

  return {
    kind: "weather",
    state: "live",
    action,
    basis: details
      ? `The checked daily forecast reports ${details}.`
      : "The checked daily forecast has no usable rain or wind values.",
    fallback,
    evidenceStatus: "Forecast freshness: fresh",
    sourceTime: snapshot.fetchedAt,
    supportingMetrics: metrics,
    checked: [`Open-Meteo daily forecast for ${request.locationName}`],
    notChecked: weatherBoundaries,
    isPrior: false,
  };
}

export function projectSurfConditionDecision(
  request: DecisionRequest<SurfConditionSnapshot>,
): LiveConditionDecision {
  const metrics = surfMetrics(request.snapshot);
  const snapshot = request.snapshot;

  if (request.isLoading && !snapshot) {
    return loadingDecision("surf", metrics, "Checking weather and the Dapa tide-station proxy.");
  }
  if (request.hasError && !snapshot) {
    return unavailableSurfDecision(metrics, "Surf signals could not be checked.");
  }
  if (!snapshot || snapshot.status === "unavailable") {
    return unavailableSurfDecision(metrics, "No usable weather or tide signals are available.");
  }
  if (request.hasError || request.isRefreshing || snapshot.weather.freshness === "stale") {
    return {
      kind: "surf",
      state: "stale",
      action: "Keep surf plans flexible and confirm locally.",
      basis: request.hasError
        ? "The latest refresh failed, so these are prior weather and tide signals."
        : "The weather signal is prior data, so the surf view is not current verification.",
      fallback: "Keep an on-land plan ready and recheck conditions before paddling out.",
      evidenceStatus: surfEvidenceStatus(snapshot),
      ...(snapshot.tide.bestWindow ? { timing: snapshot.tide.bestWindow } : {}),
      supportingMetrics: metrics,
      checked: checkedSurfSignals(snapshot),
      notChecked: surfBoundaries,
      isPrior: true,
    };
  }
  const isPartial = snapshot.status === "partial";
  if (snapshot.weather.freshness === "unknown" && !isPartial) {
    return {
      kind: "surf",
      state: "not-verified",
      action: "Keep surf plans flexible and confirm locally.",
      basis: "Some weather and tide values are available, but weather freshness is not confirmed.",
      fallback: "Keep an on-land plan ready and recheck conditions before paddling out.",
      evidenceStatus: surfEvidenceStatus(snapshot),
      ...(snapshot.tide.bestWindow ? { timing: snapshot.tide.bestWindow } : {}),
      supportingMetrics: metrics,
      checked: checkedSurfSignals(snapshot),
      notChecked: surfBoundaries,
      isPrior: false,
    };
  }

  const hasWindow = Boolean(snapshot.tide.bestWindow);
  return {
    kind: "surf",
    state: isPartial ? "partial" : "live",
    action: hasWindow
      ? "Use the Dapa tide window as a planning cue, then confirm locally."
      : "Keep surf plans flexible and confirm locally.",
    basis: isPartial
      ? partialSurfBasis(snapshot)
      : "Weather and Dapa tide signals are available; Dapa remains a nearby station proxy, not an exact-break reading.",
    fallback: "Keep an on-land plan ready and confirm conditions before paddling out.",
    evidenceStatus: surfEvidenceStatus(snapshot),
    ...(snapshot.tide.bestWindow ? { timing: snapshot.tide.bestWindow } : {}),
    supportingMetrics: metrics,
    checked: checkedSurfSignals(snapshot),
    notChecked: surfBoundaries,
    isPrior: false,
  };
}

export function conditionDecisionSummaryFields(
  decision: LiveConditionDecision,
): ConditionDecisionSummaryFields {
  return {
    bestAction: decision.action,
    basis: decision.basis,
    fallback: decision.fallback,
    ...(decision.timing ? { timing: decision.timing } : {}),
  };
}

function loadingDecision(
  kind: LiveConditionDecision["kind"],
  supportingMetrics: ConditionSupportingMetric[],
  basis: string,
): LiveConditionDecision {
  return {
    kind,
    state: "loading",
    action: "Checking current conditions.",
    basis,
    fallback: "Keep plans flexible until current signals are available.",
    supportingMetrics,
    checked: [],
    notChecked: [],
    isPrior: false,
  };
}

function unavailableWeatherDecision(
  supportingMetrics: ConditionSupportingMetric[],
  basis: string,
): LiveConditionDecision {
  return {
    kind: "weather",
    state: "unavailable",
    action: "Conditions unavailable; keep the plan flexible.",
    basis,
    fallback: "Choose a covered stop and check again before committing to an exposed plan.",
    evidenceStatus: "Forecast freshness: unavailable",
    supportingMetrics,
    checked: [],
    notChecked: ["Weather forecast", ...weatherBoundaries],
    isPrior: false,
  };
}

function unavailableSurfDecision(
  supportingMetrics: ConditionSupportingMetric[],
  basis: string,
): LiveConditionDecision {
  return {
    kind: "surf",
    state: "unavailable",
    action: "Conditions unavailable; keep surf plans flexible.",
    basis,
    fallback: "Keep an on-land plan ready and confirm conditions before paddling out.",
    evidenceStatus: "Weather and tide freshness: unavailable",
    supportingMetrics,
    checked: [],
    notChecked: ["Weather, tide, swell, and wind signals", ...surfBoundaries],
    isPrior: false,
  };
}

function weatherMetrics(
  snapshot: WeatherConditionSnapshot | undefined,
): ConditionSupportingMetric[] {
  return [
    {
      label: "Rain chance",
      value: formatNullableNumber(snapshot?.today.precipitationProbability, "%"),
    },
    {
      label: "Rain",
      value: formatNullableNumber(
        snapshot?.today.rainSum ?? snapshot?.today.precipitationSum,
        " mm",
      ),
    },
    snapshot?.today.windGust !== null && snapshot?.today.windGust !== undefined
      ? {
          label: "Wind gust",
          value: formatNullableNumber(snapshot.today.windGust, " km/h"),
        }
      : {
          label: "Wind",
          value: formatNullableNumber(snapshot?.today.windSpeed, " km/h"),
        },
  ];
}

function surfMetrics(snapshot: SurfConditionSnapshot | undefined): ConditionSupportingMetric[] {
  return [
    { label: "Waves", value: snapshot?.metrics.waves ?? "Unavailable" },
    { label: "Tide", value: snapshot?.metrics.tide ?? "Unavailable" },
    { label: "Wind", value: snapshot?.metrics.wind ?? "Unavailable" },
  ];
}

function weatherLevel(snapshot: WeatherConditionSnapshot): "low" | "medium" | "high" {
  const rain = snapshot.today.rainSum ?? snapshot.today.precipitationSum;
  if (
    (snapshot.today.precipitationProbability ?? 0) >= 75 ||
    (rain ?? 0) >= 18 ||
    (snapshot.today.windGust ?? 0) >= 55 ||
    (snapshot.today.windSpeed ?? 0) >= 40
  ) {
    return "high";
  }
  if (
    (snapshot.today.precipitationProbability ?? 0) >= 45 ||
    (rain ?? 0) >= 6 ||
    (snapshot.today.windGust ?? 0) >= 35 ||
    (snapshot.today.windSpeed ?? 0) >= 25
  ) {
    return "medium";
  }
  return "low";
}

function weatherDetails(snapshot: WeatherConditionSnapshot) {
  const rain = snapshot.today.rainSum ?? snapshot.today.precipitationSum;
  const details = [
    snapshot.today.precipitationProbability === null
      ? undefined
      : `${formatNumber(snapshot.today.precipitationProbability)}% rain chance`,
    rain === null ? undefined : `${formatNumber(rain)} mm rain`,
    snapshot.today.windGust === null
      ? snapshot.today.windSpeed === null || snapshot.today.windSpeed === undefined
        ? undefined
        : `${formatNumber(snapshot.today.windSpeed)} km/h wind`
      : `${formatNumber(snapshot.today.windGust)} km/h gusts`,
  ].filter((value): value is string => Boolean(value));
  return details.join(", ");
}

function partialSurfBasis(snapshot: SurfConditionSnapshot) {
  const available = checkedSurfSignals(snapshot);
  const missing = [
    snapshot.weather.status === "live" ? undefined : "weather",
    snapshot.tide.status === "live" ? undefined : "tide",
    metricUnavailable(snapshot.metrics.waves) ? "swell" : undefined,
    metricUnavailable(snapshot.metrics.wind) ? "wind" : undefined,
  ].filter((value): value is string => Boolean(value));
  const availableText = available.length > 0 ? available.join(" and ") : "No usable surf signals";
  const missingText = missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
  const freshnessText =
    snapshot.weather.status === "live" && snapshot.weather.freshness === "unknown"
      ? " Weather freshness is not confirmed."
      : "";
  return `${availableText} are available, but this is partial evidence.${missingText}${freshnessText}`;
}

function checkedSurfSignals(snapshot: SurfConditionSnapshot) {
  return [
    snapshot.weather.status === "live" ? "Open-Meteo weather" : undefined,
    snapshot.tide.status === "live" ? `${snapshot.tide.stationName} tide proxy` : undefined,
    metricUnavailable(snapshot.metrics.waves) ? undefined : "supplied swell signal",
    metricUnavailable(snapshot.metrics.wind) ? undefined : "supplied wind signal",
  ].filter((value): value is string => Boolean(value));
}

function surfEvidenceStatus(snapshot: SurfConditionSnapshot) {
  const weatherFreshness = `Weather freshness: ${snapshot.weather.freshness}`;
  return snapshot.tide.status === "live"
    ? `${weatherFreshness}; Dapa tide freshness was not supplied.`
    : `${weatherFreshness}; Dapa tide data unavailable.`;
}

function metricUnavailable(value: string) {
  return value.trim().toLowerCase() === "unavailable" || value.trim() === "-";
}

function formatNullableNumber(value: number | null | undefined, suffix: string) {
  return value === null || value === undefined ? "Unavailable" : `${formatNumber(value)}${suffix}`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
