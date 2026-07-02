import type {
  AgentTurnResult,
  ChatAction,
  ChatClientGeolocationContext,
  DecisionSummary,
  ItineraryPlan,
  PublicAgentToolCall,
  RecommendationCard,
} from "@/server/chat/agent-runtime";
import { publicAgentToolCallsFromAudits } from "@/server/chat/agent-runtime";
import {
  type AnswerSourceSummary,
  renderAnswerSourceLines,
} from "@/server/chat/answer-source-summary";
import {
  assertChatAnswerSourceConsistency,
  SourceConsistencyError,
} from "@/server/chat/source-consistency";

export type StoredChatTurnToolCall = {
  id: string;
  toolCallId?: string;
  name: string;
  status: PublicAgentToolCall["status"];
  errorCode?: string;
  providerOperation?: string;
  sourceProfileIds: readonly string[];
  sources: readonly AnswerSourceSummary[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export type PublicChatTurnAssembly = {
  message: string;
  toolCalls: readonly PublicAgentToolCall[];
  sources: readonly AnswerSourceSummary[];
  cards: readonly RecommendationCard[];
  actions: readonly ChatAction[];
  itineraries: readonly ItineraryPlan[];
  decisionSummaries: readonly DecisionSummary[];
  storedHistory: {
    sources: readonly AnswerSourceSummary[];
    cards: readonly RecommendationCard[];
    actions: readonly ChatAction[];
    itineraries: readonly ItineraryPlan[];
    decisionSummaries: readonly DecisionSummary[];
    toolCalls: readonly StoredChatTurnToolCall[];
  };
  repair?: {
    issueCount: number;
    repairedLineCount: number;
  };
};

export function assemblePublicChatTurn({
  browserGeolocation,
  result,
}: {
  result: AgentTurnResult;
  browserGeolocation: ChatClientGeolocationContext;
}): PublicChatTurnAssembly {
  const publicToolCalls = publicAgentToolCallsFromAudits(result.toolCalls);
  const publicAnswerSources = chatAnswerSourcesForValidation(
    result.publicSources,
    result.cards,
    result.itineraries,
    result.decisionSummaries,
  );
  let responseMessage = stripInternalDisclosureText(result.message);
  let repair: PublicChatTurnAssembly["repair"];
  const sourceValidationInput = {
    message: responseMessage,
    sources: publicAnswerSources,
    toolCalls: result.toolCalls,
    browserGeolocation,
  };

  try {
    assertChatAnswerSourceConsistency(sourceValidationInput);
  } catch (error) {
    if (!(error instanceof SourceConsistencyError)) {
      throw error;
    }
    const repairedMessage = repairMalformedRenderedSourceLines(responseMessage, error);
    if (!repairedMessage) {
      throw error;
    }
    responseMessage = stripInternalDisclosureText(repairedMessage);
    assertChatAnswerSourceConsistency({
      ...sourceValidationInput,
      message: responseMessage,
    });
    repair = {
      issueCount: error.issues.length,
      repairedLineCount: result.message.split("\n").length - responseMessage.split("\n").length,
    };
  }

  assertRenderedSourceLinesArePublic(responseMessage, publicAnswerSources);

  return {
    message: responseMessage,
    toolCalls: publicToolCalls,
    sources: result.publicSources,
    cards: result.cards ?? [],
    actions: result.actions ?? [],
    itineraries: result.itineraries ?? [],
    decisionSummaries: result.decisionSummaries ?? [],
    storedHistory: {
      sources: result.publicSources,
      cards: result.cards ?? [],
      actions: result.actions ?? [],
      itineraries: result.itineraries ?? [],
      decisionSummaries: result.decisionSummaries ?? [],
      toolCalls: summarizeToolCallsForStoredHistory(publicToolCalls),
    },
    ...(repair ? { repair } : {}),
  };
}

function chatAnswerSourcesForValidation(
  sources: readonly AnswerSourceSummary[],
  cards: readonly RecommendationCard[] | undefined,
  itineraries: readonly ItineraryPlan[] | undefined,
  decisionSummaries: readonly DecisionSummary[] | undefined,
) {
  return [
    ...sources,
    ...(cards?.flatMap((card) => card.sources ?? []) ?? []),
    ...(itineraries?.flatMap((itinerary) => itinerary.sources) ?? []),
    ...(decisionSummaries?.flatMap((summary) => summary.sources) ?? []),
  ];
}

function assertRenderedSourceLinesArePublic(
  message: string,
  publicSources: readonly AnswerSourceSummary[],
) {
  const renderedSourceLines = message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Checked: ") || line.startsWith("Not checked: "));
  if (renderedSourceLines.length === 0) {
    return;
  }

  const publicSourceLines = new Set(renderAnswerSourceLines(publicSources));
  const nonPublicLines = renderedSourceLines.filter((line) => !publicSourceLines.has(line));
  if (nonPublicLines.length === 0) {
    return;
  }

  throw new SourceConsistencyError(
    nonPublicLines.map((line) => ({
      code: "structured_source_not_tool_backed",
      line,
      message:
        "Rendered source lines must be represented by public response sources or selected artifacts.",
    })),
  );
}

function repairMalformedRenderedSourceLines(
  message: string,
  error: SourceConsistencyError,
): string | undefined {
  if (
    error.issues.length === 0 ||
    error.issues.some((issue) => issue.code !== "rendered_source_label_unknown")
  ) {
    return undefined;
  }

  const invalidLines = new Set(error.issues.flatMap((issue) => (issue.line ? [issue.line] : [])));
  if (invalidLines.size === 0) {
    return undefined;
  }

  const repaired = message
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !invalidLines.has(trimmed) ||
        (!trimmed.startsWith("Checked: ") && !trimmed.startsWith("Not checked: "))
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return repaired.length > 0 && repaired !== message ? repaired : undefined;
}

function stripInternalDisclosureText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => stripInternalDisclosureSentences(line))
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripInternalDisclosureSentences(line: string) {
  const trimmedLine = line.trim();
  if (/^not checked:/i.test(trimmedLine)) {
    return "";
  }

  return line
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !isInternalDisclosure(sentence))
    .join(" ")
    .trim();
}

function isInternalDisclosure(value: string) {
  return [
    /\bnot\s+checked\b/i,
    /\bwasn['’]?t\s+(?:separately\s+)?checked\b/i,
    /\bwere\s+not\s+checked\b/i,
    /\bno\s+live\b.{0,90}\bcheck\b/i,
    /\bunchecked\b/i,
    /\bnot\s+verified\b/i,
    /\bI\s+(?:didn['’]?t|did\s+not)\s+(?:live[-\s]?)?check\b/i,
    /\b(?:live[-\s]?)?check(?:ed|ing)?\s+(?:was|were|is|are)?\s*(?:not|needed|needs)\b/i,
    /\bcurated\s+local\s+guide\s+estimate\b/i,
    /\bexact\s+ride\s+time\s+depends\b/i,
    /\buser\s+constraints\s+preserved\b/i,
    /\borigin-specific\s+route\s+timing\b/i,
    /\bthis\s+artifact\b/i,
    /\bsource\s+caveats?\b/i,
    /\bavoid\s+overclaiming\b/i,
    /\buse\s+(?:search_places|places)\b/i,
    /\bplaces\s+evidence\b/i,
    /\b(?:open|opening|cafe|menu|booking|availability|crowd|quietness).{0,80}\bshould\s+be\s+checked\b/i,
    /\bclaim(?:ing)?\b.{0,80}\b(?:open|status|hours|safety|reliability)\b/i,
    /\bwithout\b.{0,80}\b(?:condition|safety|tide|surf|road).{0,40}\bcheck/i,
  ].some((pattern) => pattern.test(value));
}

function summarizeToolCallsForStoredHistory(toolCalls: readonly PublicAgentToolCall[]) {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    ...(toolCall.toolCallId ? { toolCallId: toolCall.toolCallId } : {}),
    name: toolCall.name,
    status: toolCall.status,
    ...(toolCall.errorCode ? { errorCode: toolCall.errorCode } : {}),
    ...(toolCall.providerOperation ? { providerOperation: toolCall.providerOperation } : {}),
    sourceProfileIds: toolCall.sourceProfileIds,
    sources: toolCall.sources,
    startedAt: toolCall.startedAt,
    completedAt: toolCall.completedAt,
    durationMs: toolCall.durationMs,
  }));
}
