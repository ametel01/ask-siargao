import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import type { TripPassUsageMeter } from "@/server/payments/trip-pass";
import {
  readTripPassEnvironment,
  type TripPassMeterType,
  tripPassFreeMeterLimits,
  tripPassProductCatalog,
  tripPassWarningThresholds,
} from "@/server/trip-pass/catalog";
import { getEffectiveTripPass } from "@/server/trip-pass/entitlement";

export type TripPassAccountState = "free" | "pending" | "active" | "expired" | "unavailable";

export type TripPassAllowancePresentation = {
  meterType: TripPassMeterType;
  used: number;
  limit: number;
  remaining: number;
  warning: boolean;
};

export type TripPassAccountPresentation = {
  status: TripPassAccountState;
  product: {
    label: string;
    durationDays: number;
  };
  validity: {
    startsAt: string | null;
    expiresAt: string | null;
  };
  allowances: TripPassAllowancePresentation[];
  attention: {
    lowChatMessages: boolean;
    lowLiveRefreshes: boolean;
    expiresSoon: boolean;
  };
  checkout: {
    status: "available" | "disabled" | "unavailable";
    reason: "checkout_disabled" | "checkout_unavailable" | null;
  };
  actions: {
    startCheckout: boolean;
  };
};

type PendingOrderRow = {
  status: string;
  created_at: Date | string;
};

export async function buildTripPassAccountPresentation(
  input: { userId: string; now?: Date },
  options: {
    db?: DatabaseQueryClient;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<TripPassAccountPresentation> {
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const now = input.now ?? new Date();
  const checkout = readCheckoutPresentation(options.env);
  const decision = await getEffectiveTripPass({ userId: input.userId, now }, db);
  const activeOrLatestPass = decision.status === "none" ? null : decision.pass;

  if (decision.status === "active") {
    return createPresentation({
      status: "active",
      checkout,
      meters: decision.meters,
      startsAt: decision.pass.startsAt,
      expiresAt: decision.pass.expiresAt,
      now,
    });
  }

  const pendingOrder = await loadLatestPendingOrder(input.userId, db);
  if (pendingOrder) {
    return createPresentation({
      status: "pending",
      checkout,
      meters: freeAllowanceMeters(),
      startsAt: null,
      expiresAt: null,
      now,
    });
  }

  if (decision.status === "expired" || decision.status === "revoked") {
    return createPresentation({
      status: "expired",
      checkout,
      meters: decision.meters,
      startsAt: activeOrLatestPass?.startsAt ?? null,
      expiresAt: activeOrLatestPass?.expiresAt ?? null,
      now,
    });
  }

  if (checkout.status === "unavailable") {
    return createPresentation({
      status: "unavailable",
      checkout,
      meters: freeAllowanceMeters(),
      startsAt: null,
      expiresAt: null,
      now,
    });
  }

  return createPresentation({
    status: "free",
    checkout,
    meters: freeAllowanceMeters(),
    startsAt: null,
    expiresAt: null,
    now,
  });
}

function createPresentation(input: {
  status: TripPassAccountState;
  checkout: TripPassAccountPresentation["checkout"];
  meters: MeterLike[];
  startsAt: Date | null;
  expiresAt: Date | null;
  now: Date;
}): TripPassAccountPresentation {
  const allowances = input.meters.map((meter) => {
    const remaining = Math.max(meter.limit - meter.used, 0);
    return {
      meterType: meter.meterType,
      used: meter.used,
      limit: meter.limit,
      remaining,
      warning: isMeterWarning(meter.meterType, remaining),
    };
  });

  return {
    status: input.status,
    product: {
      label: tripPassProductCatalog.label,
      durationDays: tripPassProductCatalog.durationDays,
    },
    validity: {
      startsAt: input.startsAt?.toISOString() ?? null,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
    allowances,
    attention: {
      lowChatMessages: allowanceWarning(allowances, "chat_message"),
      lowLiveRefreshes: allowanceWarning(allowances, "live_refresh"),
      expiresSoon: expiresSoon(input.expiresAt, input.now),
    },
    checkout: input.checkout,
    actions: {
      startCheckout: input.checkout.status === "available",
    },
  };
}

type MeterLike = Pick<TripPassUsageMeter, "meterType" | "used" | "limit">;

function freeAllowanceMeters(): MeterLike[] {
  return Object.entries(tripPassFreeMeterLimits).map(([meterType, limit]) => ({
    meterType: meterType as TripPassMeterType,
    used: 0,
    limit,
  }));
}

function readCheckoutPresentation(env: Record<string, string | undefined> | undefined) {
  try {
    const checkout = readTripPassEnvironment(env).checkout;
    if (checkout.status === "available") {
      return { status: "available" as const, reason: null };
    }
    return {
      status: checkout.status,
      reason:
        checkout.status === "disabled"
          ? ("checkout_disabled" as const)
          : ("checkout_unavailable" as const),
    };
  } catch {
    return { status: "unavailable" as const, reason: "checkout_unavailable" as const };
  }
}

function isMeterWarning(meterType: TripPassMeterType, remaining: number) {
  if (meterType === "chat_message") {
    return remaining <= tripPassWarningThresholds.chatRemaining;
  }
  if (meterType === "live_refresh") {
    return remaining <= tripPassWarningThresholds.liveRemaining;
  }
  return false;
}

function allowanceWarning(
  allowances: TripPassAllowancePresentation[],
  meterType: TripPassMeterType,
) {
  return allowances.some((allowance) => allowance.meterType === meterType && allowance.warning);
}

function expiresSoon(expiresAt: Date | null, now: Date) {
  if (!expiresAt) {
    return false;
  }

  return (
    expiresAt.getTime() > now.getTime() &&
    expiresAt.getTime() - now.getTime() <=
      tripPassWarningThresholds.expiresWithinHours * 60 * 60_000
  );
}

async function loadLatestPendingOrder(userId: string, db: DatabaseQueryClient) {
  const result = await db.query<PendingOrderRow>(
    `
      select status, created_at
      from trip_pass_orders
      where user_id = $1
        and status in ('pending', 'checkout_created')
      order by created_at desc
      limit 1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}
