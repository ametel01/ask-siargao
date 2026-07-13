export type AnswerArrivalMotionKind = "decision-strip-sequence";

export type AnswerArrivalMotionActivation = {
  kind: AnswerArrivalMotionKind;
  token: string;
};

type AnswerArrivalMotionCandidate = {
  messageId: string;
  previousStatus: "pending" | "complete" | "error" | "stopped" | undefined;
  nextStatus: "pending" | "complete" | "error" | "stopped" | undefined;
  hasDecisionStrip: boolean;
};

const consumedArrivalMotionTokens = new Set<string>();

export function createAnswerArrivalMotionActivation({
  messageId,
  previousStatus,
  nextStatus,
  hasDecisionStrip,
}: AnswerArrivalMotionCandidate): AnswerArrivalMotionActivation | undefined {
  if (previousStatus !== "pending" || nextStatus !== "complete" || !hasDecisionStrip) {
    return undefined;
  }

  return {
    kind: "decision-strip-sequence",
    token: `${messageId}:decision-strip-sequence`,
  };
}

export function consumeAnswerArrivalMotionActivation(
  activation: AnswerArrivalMotionActivation | undefined,
  options: { reducedMotion: boolean },
): boolean {
  if (!activation || options.reducedMotion || consumedArrivalMotionTokens.has(activation.token)) {
    return false;
  }

  consumedArrivalMotionTokens.add(activation.token);
  return true;
}

export function resetAnswerArrivalMotionForTests() {
  consumedArrivalMotionTokens.clear();
}
