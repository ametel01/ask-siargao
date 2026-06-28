import type { AgentToolCallAudit, ChatClientGeolocationContext } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";

export type SourceConsistencyIssueCode =
  | "browser_geolocation_claim_not_tool_backed"
  | "browser_geolocation_coordinates_rendered"
  | "generic_reasoning_mislabeled"
  | "provider_unavailable_without_tool_failure"
  | "rendered_checked_line_not_verifiable"
  | "rendered_source_label_unknown"
  | "structured_source_not_tool_backed"
  | "unsupported_checked_label";

export type SourceConsistencyIssue = {
  code: SourceConsistencyIssueCode;
  label?: AnswerTrustLabel;
  line?: string;
  sourceName?: string;
  message: string;
};

export type SourceConsistencyValidationInput = {
  browserGeolocation?: ChatClientGeolocationContext;
  message?: string;
  sources?: readonly AnswerSourceSummary[];
  toolCalls?: readonly AgentToolCallAudit[];
};

export type SourceConsistencyValidationResult = {
  valid: boolean;
  issues: readonly SourceConsistencyIssue[];
};

type SourceClaim = {
  origin: "structured_source" | "rendered_source_line";
  label?: AnswerTrustLabel;
  lineKind?: "checked" | "not_checked";
  line?: string;
  sourceName?: string;
  checkedText?: string;
};

type ToolSourceEvidence = {
  toolName: string;
  label: AnswerTrustLabel;
  sourceName: string;
  checkedText: string;
  notCheckedText: string;
};

const renderedTrustLabels: Record<string, AnswerTrustLabel> = {
  "curated local guide": "curated_local_guide",
  "fresh cache": "fresh_cache",
  "live checked": "live_checked",
  "not verified": "not_verified",
  "provider unavailable": "provider_unavailable",
  "weather checked": "weather_checked",
};

const placesToolNames = new Set(["search_places", "get_place_details"]);
const sourceLinePattern = /^(Checked|Not checked):\s+(.+?)\s+\(([^)]*)\)\s+-\s+(.+)\.$/u;

export class SourceConsistencyError extends Error {
  readonly code = "source_consistency_failed";
  readonly statusCode = 502;
  readonly issues: readonly SourceConsistencyIssue[];

  constructor(issues: readonly SourceConsistencyIssue[]) {
    super("Chat answer source labels were not backed by tool evidence.");
    this.name = "SourceConsistencyError";
    this.issues = issues;
  }
}

export function validateChatAnswerSourceConsistency({
  browserGeolocation,
  message,
  sources = [],
  toolCalls = [],
}: SourceConsistencyValidationInput): SourceConsistencyValidationResult {
  const evidence = summarizeToolEvidence(toolCalls);
  const claims = [
    ...sources.map(sourceSummaryToClaim),
    ...extractRenderedSourceClaims(message ?? ""),
  ];
  const issues = [
    ...validateBrowserGeolocationProse(message ?? "", browserGeolocation, evidence),
    ...claims.flatMap((claim) => validateSourceClaim(claim, evidence)),
  ];

  return {
    valid: issues.length === 0,
    issues,
  };
}

function validateBrowserGeolocationProse(
  message: string,
  geolocation: ChatClientGeolocationContext | undefined,
  evidence: ReturnType<typeof summarizeToolEvidence>,
): SourceConsistencyIssue[] {
  const issues: SourceConsistencyIssue[] = [];
  const proseMessage = messageWithoutRenderedSourceLines(message);

  if (hasBrowserGeolocationUsageClaim(proseMessage) && !evidence.browserGeolocationPlaces) {
    issues.push({
      code: "browser_geolocation_claim_not_tool_backed",
      message: "Shared-location prose claims require a matching geolocated Places tool output.",
    });
  }

  if (!hasExactBrowserGeolocation(geolocation)) {
    return issues;
  }

  const latitudeVariants = coordinateStringVariants(geolocation.latitude);
  const longitudeVariants = coordinateStringVariants(geolocation.longitude);
  if (
    !hasAnyNumericLiteral(message, latitudeVariants) &&
    !hasAnyNumericLiteral(message, longitudeVariants)
  ) {
    return issues;
  }

  issues.push({
    code: "browser_geolocation_coordinates_rendered",
    message: "Traveler-facing answers must not render exact browser geolocation coordinates.",
  });
  return issues;
}

function messageWithoutRenderedSourceLines(message: string) {
  return message
    .split("\n")
    .filter(
      (line) => !line.trim().startsWith("Checked: ") && !line.trim().startsWith("Not checked: "),
    )
    .join("\n");
}

function hasBrowserGeolocationUsageClaim(message: string) {
  return browserGeolocationUsageClaimPatterns.some((pattern) => pattern.test(message));
}

const browserGeolocationUsageClaimPatterns = [
  /\b(?:used|using|based\s+on|from|with|searched|checked|looked|found)\b.{0,80}\b(?:your|the)\s+(?:shared|current|browser)?\s*(?:location|geolocation)\b/iu,
  /\b(?:your|the)\s+(?:shared|current|browser)\s+(?:location|geolocation)\b.{0,80}\b(?:search\s+center|nearby\s+search|to\s+find|for\s+nearby|as\s+(?:the\s+)?(?:search\s+)?center)\b/iu,
  /\bnear\s+your\s+(?:shared|current|browser)\s+(?:location|geolocation)\b/iu,
  /\bbrowser\s+geolocation\s+search\s+center\b/iu,
];

function hasExactBrowserGeolocation(
  geolocation: ChatClientGeolocationContext | undefined,
): geolocation is ChatClientGeolocationContext & { latitude: number; longitude: number } {
  return (
    geolocation?.status === "available" &&
    geolocation.source === "browser_geolocation" &&
    typeof geolocation.latitude === "number" &&
    typeof geolocation.longitude === "number"
  );
}

function coordinateStringVariants(value: number) {
  const variants = new Set<string>();
  for (const variant of [
    String(value),
    ...[3, 4, 5, 6, 7].map((digits) => trimTrailingZeroes(value.toFixed(digits))),
  ]) {
    if (decimalFractionLength(variant) >= 3) {
      variants.add(variant);
    }
  }
  return variants;
}

function trimTrailingZeroes(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, ".0");
}

function decimalFractionLength(value: string) {
  return value.split(".")[1]?.length ?? 0;
}

function hasAnyNumericLiteral(value: string, literals: ReadonlySet<string>) {
  return [...literals].some((literal) => numericLiteralPattern(literal).test(value));
}

function numericLiteralPattern(literal: string) {
  return new RegExp(`(^|[^\\d.])${escapeRegExp(literal)}(?=$|[^\\d.])`, "u");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function assertChatAnswerSourceConsistency(input: SourceConsistencyValidationInput) {
  const result = validateChatAnswerSourceConsistency(input);
  if (!result.valid) {
    throw new SourceConsistencyError(result.issues);
  }
}

function validateSourceClaim(
  claim: SourceClaim,
  evidence: ReturnType<typeof summarizeToolEvidence>,
): SourceConsistencyIssue[] {
  if (!claim.label) {
    return [
      {
        code: "rendered_source_label_unknown",
        line: claim.line,
        sourceName: claim.sourceName,
        message: "Rendered source line did not include a known Ask Siargao source label.",
      },
    ];
  }

  if (isGenericReasoningSource(claim.sourceName) && claim.label !== "not_verified") {
    return [
      {
        code: "generic_reasoning_mislabeled",
        label: claim.label,
        line: claim.line,
        sourceName: claim.sourceName,
        message: "Generic model reasoning cannot be labeled as a verified source check.",
      },
    ];
  }

  if (claim.lineKind === "checked" && !isVerifyingLabel(claim.label)) {
    return [
      {
        code: "unsupported_checked_label",
        label: claim.label,
        line: claim.line,
        sourceName: claim.sourceName,
        message: "Rendered checked source lines must use a tool-verifiable source label.",
      },
    ];
  }

  if (claim.label === "not_verified") {
    return [];
  }

  if (isUnsupportedCheckedClaim(claim)) {
    return [
      {
        code: "unsupported_checked_label",
        label: claim.label,
        line: claim.line,
        sourceName: claim.sourceName,
        message:
          "Tide, surf, road, safety, and official-warning claims cannot be labeled checked yet.",
      },
    ];
  }

  if (claim.label === "provider_unavailable") {
    if (evidence.providerUnavailable) {
      return [];
    }
    return [
      {
        code: "provider_unavailable_without_tool_failure",
        label: claim.label,
        line: claim.line,
        sourceName: claim.sourceName,
        message: "Provider-unavailable source claims require a failed or fallback tool output.",
      },
    ];
  }

  if (isBrowserGeolocationCheckedClaim(claim) && !evidence.browserGeolocationPlaces) {
    return [
      {
        code:
          claim.origin === "rendered_source_line"
            ? "rendered_checked_line_not_verifiable"
            : "structured_source_not_tool_backed",
        label: claim.label,
        line: claim.line,
        sourceName: claim.sourceName,
        message:
          "Browser-geolocation source claims require a matching geolocated Places tool output.",
      },
    ];
  }

  if (isToolBackedClaimSupported(claim, evidence)) {
    return [];
  }

  return [
    {
      code:
        claim.origin === "rendered_source_line"
          ? "rendered_checked_line_not_verifiable"
          : "structured_source_not_tool_backed",
      label: claim.label,
      line: claim.line,
      sourceName: claim.sourceName,
      message: "Verified source claims require matching successful tool output evidence.",
    },
  ];
}

function summarizeToolEvidence(toolCalls: readonly AgentToolCallAudit[]) {
  return {
    toolSources: summarizeToolSources(toolCalls),
    browserGeolocationPlaces: toolCalls.some(
      (toolCall) =>
        toolCall.status === "success" &&
        toolCall.name === "search_places" &&
        hasBrowserGeolocationSearchCenterArgument(toolCall.arguments) &&
        toolCall.sources.some((source) => hasBrowserGeolocationCheckedText(source.checked)),
    ),
    livePlaces: hasToolSourceLabel(toolCalls, placesToolNames, "live_checked"),
    freshPlaces: hasToolSourceLabel(
      toolCalls,
      new Set([...placesToolNames, "query_local_facts", "get_source_evidence"]),
      "fresh_cache",
    ),
    weather: hasToolSourceLabel(
      toolCalls,
      new Set(["get_weather_forecast", "get_condition_judgment"]),
      "weather_checked",
    ),
    localGuide: hasToolSourceLabel(
      toolCalls,
      new Set([
        "get_condition_judgment",
        "search_local_guide",
        "plan_local_itinerary",
        "query_local_facts",
        "get_source_evidence",
      ]),
      "curated_local_guide",
    ),
    providerUnavailable: toolCalls.some(
      (toolCall) =>
        toolCall.status === "error" ||
        toolCall.errorCode === "provider_unavailable" ||
        toolCall.sources.some((source) => source.label === "provider_unavailable"),
    ),
  };
}

function summarizeToolSources(toolCalls: readonly AgentToolCallAudit[]): ToolSourceEvidence[] {
  return toolCalls.flatMap((toolCall) => {
    if (toolCall.status !== "success") {
      return [];
    }
    return toolCall.sources.map((source) => ({
      toolName: toolCall.name,
      label: source.label,
      sourceName: normalizeText(source.sourceName),
      checkedText: formatItems(normalizeItems(source.checked)),
      notCheckedText: formatItems(normalizeItems(source.notChecked)),
    }));
  });
}

function isBrowserGeolocationCheckedClaim(claim: SourceClaim) {
  if (!claim.label || !isVerifyingLabel(claim.label)) {
    return false;
  }
  if (claim.origin === "rendered_source_line" && claim.lineKind !== "checked") {
    return false;
  }
  return hasBrowserGeolocationCheckedText([claim.checkedText ?? ""]);
}

function hasBrowserGeolocationCheckedText(values: readonly string[]) {
  return values.some((value) => /\bbrowser geolocation search center\b/i.test(value));
}

function hasBrowserGeolocationSearchCenterArgument(argumentsValue: Record<string, unknown>) {
  const center = argumentsValue.center;
  return isRecord(center) && center.source === "browser_geolocation";
}

function hasToolSourceLabel(
  toolCalls: readonly AgentToolCallAudit[],
  toolNames: ReadonlySet<string>,
  label: AnswerTrustLabel,
) {
  return toolCalls.some(
    (toolCall) =>
      toolCall.status === "success" &&
      toolNames.has(toolCall.name) &&
      toolCall.sources.some((source) => source.label === label),
  );
}

function isToolBackedClaimSupported(
  claim: SourceClaim,
  evidence: ReturnType<typeof summarizeToolEvidence>,
) {
  if (!claim.label) {
    return false;
  }
  const toolNames = toolNamesForVerifyingLabel(claim.label);
  if (!toolNames) {
    return false;
  }
  return evidence.toolSources.some(
    (toolSource) =>
      toolNames.has(toolSource.toolName) &&
      toolSource.label === claim.label &&
      toolSource.sourceName === normalizeText(claim.sourceName) &&
      doesClaimTextMatchToolSource(claim, toolSource),
  );
}

function toolNamesForVerifyingLabel(label: AnswerTrustLabel) {
  switch (label) {
    case "live_checked":
      return placesToolNames;
    case "fresh_cache":
      return new Set([...placesToolNames, "query_local_facts", "get_source_evidence"]);
    case "weather_checked":
      return new Set(["get_weather_forecast", "get_condition_judgment"]);
    case "curated_local_guide":
      return new Set([
        "get_condition_judgment",
        "search_local_guide",
        "plan_local_itinerary",
        "query_local_facts",
        "get_source_evidence",
      ]);
    case "not_verified":
    case "provider_unavailable":
      return undefined;
  }
}

function doesClaimTextMatchToolSource(claim: SourceClaim, toolSource: ToolSourceEvidence) {
  const claimText = normalizeText(claim.checkedText);
  if (claim.origin === "rendered_source_line" && claim.lineKind === "not_checked") {
    return claimText === toolSource.notCheckedText;
  }
  return claimText === toolSource.checkedText;
}

function isUnsupportedCheckedClaim(claim: SourceClaim) {
  if (!claim.label || !isVerifyingLabel(claim.label)) {
    return false;
  }
  if (claim.origin === "rendered_source_line" && claim.lineKind !== "checked") {
    return false;
  }
  const text = [claim.sourceName, claim.checkedText].filter(Boolean).join(" ");
  return (
    /\b(tide|surf|swell|marine|currents)\b/i.test(text) ||
    /\b(?:rip|sea|ocean)\s+current\b/i.test(text) ||
    /\b(?:road flooding|flooded roads?|road closures?|local closures?|transport warnings?)\b/i.test(
      text,
    ) ||
    /\b(?:lifeguards?|swimming safety|marine safety|official warnings?|official transport warnings?|safety warnings?)\b/i.test(
      text,
    )
  );
}

function sourceSummaryToClaim(source: AnswerSourceSummary): SourceClaim {
  return {
    origin: "structured_source",
    label: source.label,
    sourceName: source.sourceName,
    checkedText: formatItems(normalizeItems(source.checked)),
  };
}

function extractRenderedSourceClaims(message: string): SourceClaim[] {
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Checked: ") || line.startsWith("Not checked: "))
    .map(renderedSourceLineToClaim);
}

function renderedSourceLineToClaim(line: string): SourceClaim {
  const match = sourceLinePattern.exec(line);
  if (!match?.[1] || !match[2] || !match[3]) {
    return {
      origin: "rendered_source_line",
      line,
    };
  }

  return {
    origin: "rendered_source_line",
    lineKind: match[1] === "Checked" ? "checked" : "not_checked",
    line,
    sourceName: match[2],
    label: readRenderedTrustLabel(match[3]),
    checkedText: match[4],
  };
}

function readRenderedTrustLabel(metadata: string): AnswerTrustLabel | undefined {
  const parts = metadata.split(";").map((part) => normalizeText(part));
  for (const part of parts) {
    const label = renderedTrustLabels[part];
    if (label) {
      return label;
    }
  }
  return undefined;
}

function isGenericReasoningSource(sourceName: string | undefined) {
  return normalizeText(sourceName).toLowerCase() === "generic model reasoning";
}

function isVerifyingLabel(label: AnswerTrustLabel) {
  return (
    label === "live_checked" ||
    label === "fresh_cache" ||
    label === "weather_checked" ||
    label === "curated_local_guide"
  );
}

function normalizeText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeItems(items: readonly string[]) {
  return items.flatMap((item) => {
    const normalizedItem = normalizeText(item);
    return normalizedItem.length > 0 ? [normalizedItem] : [];
  });
}

function formatItems(items: readonly string[]) {
  if (items.length === 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  const lastItem = items.at(-1);
  const leadingItems = items.slice(0, -1);
  return `${leadingItems.join(", ")}, and ${lastItem}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
