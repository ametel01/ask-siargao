import { afterEach, describe, expect, test } from "bun:test";

import {
  type AnswerArrivalMotionActivation,
  consumeAnswerArrivalMotionActivation,
  createAnswerArrivalMotionActivation,
  resetAnswerArrivalMotionForTests,
} from "@/features/chat/answer-arrival-motion";

afterEach(() => {
  resetAnswerArrivalMotionForTests();
});

describe("answer arrival motion eligibility", () => {
  test("makes a live pending-to-complete decision strip eligible once", () => {
    const activation = createAnswerArrivalMotionActivation({
      messageId: "assistant_live",
      previousStatus: "pending",
      nextStatus: "complete",
      hasDecisionStrip: true,
    });

    expect(activation).toEqual({
      kind: "decision-strip-sequence",
      token: "assistant_live:decision-strip-sequence",
    });
    expect(consumeAnswerArrivalMotionActivation(activation, { reducedMotion: false })).toBe(true);
    expect(consumeAnswerArrivalMotionActivation(activation, { reducedMotion: false })).toBe(false);
  });

  test.each([
    {
      label: "pending to error",
      previousStatus: "pending",
      nextStatus: "error",
      hasDecisionStrip: true,
    },
    {
      label: "already complete hydration",
      previousStatus: "complete",
      nextStatus: "complete",
      hasDecisionStrip: true,
    },
    {
      label: "plain completed answer",
      previousStatus: "pending",
      nextStatus: "complete",
      hasDecisionStrip: false,
    },
    {
      label: "missing prior pending ownership",
      previousStatus: undefined,
      nextStatus: "complete",
      hasDecisionStrip: true,
    },
  ] as const)("keeps $label motion-ineligible", ({
    previousStatus,
    nextStatus,
    hasDecisionStrip,
  }) => {
    expect(
      createAnswerArrivalMotionActivation({
        messageId: "assistant_static",
        previousStatus,
        nextStatus,
        hasDecisionStrip,
      }),
    ).toBeUndefined();
  });

  test("gives each distinct live answer one independent activation", () => {
    const first = createAnswerArrivalMotionActivation({
      messageId: "assistant_one",
      previousStatus: "pending",
      nextStatus: "complete",
      hasDecisionStrip: true,
    });
    const second = createAnswerArrivalMotionActivation({
      messageId: "assistant_two",
      previousStatus: "pending",
      nextStatus: "complete",
      hasDecisionStrip: true,
    });

    expect(consumeAnswerArrivalMotionActivation(first, { reducedMotion: false })).toBe(true);
    expect(consumeAnswerArrivalMotionActivation(second, { reducedMotion: false })).toBe(true);
    expect(consumeAnswerArrivalMotionActivation(first, { reducedMotion: false })).toBe(false);
    expect(consumeAnswerArrivalMotionActivation(second, { reducedMotion: false })).toBe(false);
  });

  test("suppresses reduced-motion activation without consuming the normal-motion token", () => {
    const activation: AnswerArrivalMotionActivation = {
      kind: "decision-strip-sequence",
      token: "assistant_reduce:decision-strip-sequence",
    };

    expect(consumeAnswerArrivalMotionActivation(activation, { reducedMotion: true })).toBe(false);
    expect(consumeAnswerArrivalMotionActivation(activation, { reducedMotion: false })).toBe(true);
  });

  test("cleanup can cancel an unmounted activation without leaking into later tests", () => {
    const activation = createAnswerArrivalMotionActivation({
      messageId: "assistant_cleanup",
      previousStatus: "pending",
      nextStatus: "complete",
      hasDecisionStrip: true,
    });

    expect(consumeAnswerArrivalMotionActivation(activation, { reducedMotion: false })).toBe(true);
    resetAnswerArrivalMotionForTests();
    expect(consumeAnswerArrivalMotionActivation(activation, { reducedMotion: false })).toBe(true);
  });
});
