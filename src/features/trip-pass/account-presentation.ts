import type {
  TripPassAccountPresentation,
  TripPassAccountState,
  TripPassAllowancePresentation,
} from "@/server/trip-pass/presentation";

export type TripPassAccountFetchState = "loading" | "ready" | "unavailable";

export type TripPassAccountView = {
  status: TripPassAccountPresentation["status"] | TripPassAccountFetchState;
  badge: string;
  headline: string;
  detail: string;
  actionLabel: string | null;
  checkoutDisabledReason: string | null;
  supportGuidance: string | null;
  validityLabel: string | null;
  resetLabel: string;
  announcement: string;
  warnings: string[];
  allowances: TripPassAllowanceView[];
};

export type TripPassAllowanceView = TripPassAllowancePresentation & {
  label: string;
  summary: string;
};

export type MobileTripPassProjection =
  | { status: "hidden" }
  | { status: "visible"; tone: "neutral" | "warning" | "critical"; text: string };

const meterLabels: Record<string, string> = {
  chat_message: "Travel answers",
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Manila",
});

export function projectTripPassAccountView(
  presentation: TripPassAccountPresentation | null,
  fetchState: TripPassAccountFetchState,
): TripPassAccountView {
  if (fetchState === "loading") {
    return {
      status: "loading",
      badge: "Loading",
      headline: "Checking your Trip Pass",
      detail: "Loading the latest account-scoped pass status.",
      actionLabel: null,
      checkoutDisabledReason: null,
      supportGuidance: null,
      validityLabel: null,
      resetLabel: "Free travel answers reset every seven days.",
      announcement: "Trip Pass status is loading.",
      warnings: [],
      allowances: [],
    };
  }

  if (!presentation || fetchState === "unavailable") {
    return {
      status: "unavailable",
      badge: "Unavailable",
      headline: "Trip Pass status is temporarily unavailable",
      detail: "Your pass was not changed. Refresh this page before starting checkout.",
      actionLabel: null,
      checkoutDisabledReason: "Status is unavailable.",
      supportGuidance: "If this keeps happening, contact support with the time of the attempt.",
      validityLabel: null,
      resetLabel: "Free travel answers reset every seven days.",
      announcement: "Trip Pass status is temporarily unavailable.",
      warnings: ["Status could not be refreshed."],
      allowances: [],
    };
  }

  const allowances = presentation.allowances
    .filter((allowance) => allowance.meterType === "chat_message")
    .map(projectAllowanceView);
  const warnings = tripPassWarnings(presentation, allowances);
  const statusCopy = statusCopyFor(presentation.status);
  const checkoutDisabledReason = checkoutDisabledCopy(presentation);
  const validityLabel = validityCopy(presentation);

  return {
    status: presentation.status,
    badge: statusCopy.badge,
    headline: statusCopy.headline,
    detail: statusCopy.detail,
    actionLabel: presentation.actions.startCheckout ? "Start checkout" : null,
    checkoutDisabledReason,
    supportGuidance: supportGuidanceFor(presentation.status, checkoutDisabledReason),
    validityLabel,
    resetLabel:
      presentation.status === "active"
        ? "Travel answers are available until the pass expires."
        : "Free travel answers reset every seven days.",
    announcement: [statusCopy.headline, validityLabel, warnings[0]].filter(Boolean).join(" "),
    warnings,
    allowances,
  };
}

export function projectMobileTripPass(
  presentation: TripPassAccountPresentation | null | undefined,
): MobileTripPassProjection {
  if (!presentation) {
    return { status: "hidden" };
  }

  if (presentation.status === "unavailable") {
    return {
      status: "visible",
      tone: "warning",
      text: "Trip Pass status is temporarily unavailable. Your pass was not changed.",
    };
  }

  if (presentation.status === "pending") {
    return {
      status: "visible",
      tone: "neutral",
      text: "Trip Pass checkout is pending. Paid access starts after payment confirmation.",
    };
  }

  if (presentation.status === "expired") {
    return {
      status: "visible",
      tone: "critical",
      text: "Trip Pass expired. Free travel answers apply until checkout is available again.",
    };
  }

  const exhausted = presentation.allowances.find(
    (allowance) => allowance.meterType === "chat_message" && allowance.remaining === 0,
  );
  if (exhausted) {
    return {
      status: "visible",
      tone: "critical",
      text: "Travel answers are used. Manage your Trip Pass in settings.",
    };
  }

  if (presentation.attention.expiresSoon && presentation.validity.expiresAt) {
    return {
      status: "visible",
      tone: "warning",
      text: `Trip Pass expires ${formatTripPassDate(presentation.validity.expiresAt)}.`,
    };
  }

  const warning = presentation.allowances.find(
    (allowance) => allowance.meterType === "chat_message" && shouldWarnAllowance(allowance),
  );
  if (warning) {
    return {
      status: "visible",
      tone: "warning",
      text: `${meterLabel(warning.meterType)} are low: ${warning.remaining} of ${warning.limit} left.`,
    };
  }

  const answers = presentation.allowances.find(
    (allowance) => allowance.meterType === "chat_message",
  );
  if (presentation.status === "active" && answers) {
    const expiry = presentation.validity.expiresAt
      ? ` · expires ${formatTripPassDate(presentation.validity.expiresAt)}`
      : "";
    return {
      status: "visible",
      tone: "neutral",
      text: `Trip Pass · ${answers.remaining} travel answers left${expiry}`,
    };
  }

  return { status: "hidden" };
}

function projectAllowanceView(allowance: TripPassAllowancePresentation): TripPassAllowanceView {
  const label = meterLabel(allowance.meterType);
  return {
    ...allowance,
    label,
    summary:
      allowance.remaining === 0
        ? `${label} exhausted`
        : `${allowance.remaining} of ${allowance.limit} left`,
  };
}

function tripPassWarnings(
  presentation: TripPassAccountPresentation,
  allowances: TripPassAllowanceView[],
) {
  const warnings = allowances.reduce<string[]>((warnings, allowance) => {
    if (shouldWarnAllowance(allowance)) {
      warnings.push(
        allowance.remaining === 0
          ? `${allowance.label} are used.`
          : `${allowance.label} are near the limit: ${allowance.remaining} left.`,
      );
    }
    return warnings;
  }, []);

  if (presentation.attention.expiresSoon && presentation.validity.expiresAt) {
    warnings.push(`Pass expires soon: ${formatTripPassDate(presentation.validity.expiresAt)}.`);
  }

  return warnings;
}

function statusCopyFor(status: TripPassAccountState) {
  switch (status) {
    case "active":
      return {
        badge: "Active",
        headline: "Trip Pass is active",
        detail: "Your paid travel answers are available for this account.",
      };
    case "pending":
      return {
        badge: "Pending",
        headline: "Checkout is waiting for confirmation",
        detail: "Paid access starts only after the payment webhook confirms the order.",
      };
    case "expired":
      return {
        badge: "Expired",
        headline: "Trip Pass has expired",
        detail: "Free travel answers apply until another checkout is completed.",
      };
    case "unavailable":
      return {
        badge: "Unavailable",
        headline: "Trip Pass checkout is unavailable",
        detail: "Free travel answers still apply. No pass has been activated locally.",
      };
    case "free":
      return {
        badge: "Free",
        headline: "Free travel answers",
        detail:
          "Use 10 free travel answers over seven days, then start checkout when you need more.",
      };
  }
}

function checkoutDisabledCopy(presentation: TripPassAccountPresentation) {
  if (presentation.actions.startCheckout) {
    return null;
  }
  if (presentation.checkout.reason === "checkout_disabled") {
    return "Checkout is not enabled yet.";
  }
  if (presentation.checkout.reason === "checkout_unavailable") {
    return "Checkout cannot start right now.";
  }
  if (presentation.status === "active") {
    return "Checkout is not needed while this pass is active.";
  }
  return "Checkout is not available.";
}

function validityCopy(presentation: TripPassAccountPresentation) {
  if (presentation.status === "active" && presentation.validity.expiresAt) {
    return `Expires ${formatTripPassDate(presentation.validity.expiresAt)}`;
  }
  if (presentation.status === "expired" && presentation.validity.expiresAt) {
    return `Expired ${formatTripPassDate(presentation.validity.expiresAt)}`;
  }
  if (presentation.status === "pending") {
    return "Activation can lag checkout while payment is confirmed.";
  }
  return null;
}

function supportGuidanceFor(status: TripPassAccountState, checkoutDisabledReason: string | null) {
  if (status === "pending") {
    return "If payment succeeded but this still says pending after a few minutes, contact support.";
  }
  if (checkoutDisabledReason && status !== "active") {
    return "Try again later or contact support if checkout should be available.";
  }
  return null;
}

function meterLabel(meterType: string) {
  return meterLabels[meterType] ?? meterType.replaceAll("_", " ");
}

function shouldWarnAllowance(
  allowance: Pick<TripPassAllowancePresentation, "remaining" | "used" | "warning">,
) {
  return allowance.remaining === 0 || (allowance.warning && allowance.used > 0);
}

function formatTripPassDate(value: string) {
  const parts = dateFormatter.formatToParts(new Date(value));
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return day && month ? `${day} ${month}` : dateFormatter.format(new Date(value));
}
