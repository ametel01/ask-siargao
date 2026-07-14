import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { startTripPassCheckout, type TripPassCheckoutResult } from "@/server/trip-pass/commerce";
import { buildTripPassAccountPresentation } from "@/server/trip-pass/presentation";

export type TripPassAccountRouteDependencies = {
  auth?: EnsureCurrentUserDependencies["auth"];
  db: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now: () => Date;
  startTripPassCheckout: typeof startTripPassCheckout;
};

function createDefaultTripPassAccountRouteDependencies(): TripPassAccountRouteDependencies {
  return {
    db: getDefaultDatabaseQueryClient(),
    env: process.env,
    now: () => new Date(),
    startTripPassCheckout,
  };
}

const privateNoStoreHeaders = {
  "cache-control": "private, no-store",
};

export async function getTripPassAccountResponse(
  dependencies: TripPassAccountRouteDependencies = createDefaultTripPassAccountRouteDependencies(),
) {
  const currentUser = await ensureTripPassUser(dependencies);
  if (!currentUser) {
    return Response.json(
      { error: "unauthenticated" },
      { status: 401, headers: privateNoStoreHeaders },
    );
  }

  try {
    const presentation = await buildTripPassAccountPresentation(
      { userId: currentUser.userId, now: dependencies.now() },
      { db: dependencies.db, env: dependencies.env },
    );
    return Response.json(presentation, { headers: privateNoStoreHeaders });
  } catch {
    return Response.json(
      { error: "trip_pass_status_unavailable" },
      { status: 503, headers: privateNoStoreHeaders },
    );
  }
}

export async function postTripPassCheckoutResponse(
  request: Request,
  dependencies: TripPassAccountRouteDependencies = createDefaultTripPassAccountRouteDependencies(),
  headers?: HeadersInit,
) {
  const responseHeaders = { ...privateNoStoreHeaders, ...headers };
  if (!isAllowedMutationOrigin(request)) {
    return Response.json(
      { error: "invalid_request_origin" },
      { status: 403, headers: responseHeaders },
    );
  }

  const currentUser = await ensureTripPassUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401, headers: responseHeaders });
  }

  try {
    const result = await dependencies.startTripPassCheckout(
      {
        userId: currentUser.userId,
        appUrl: dependencies.env?.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
      },
      {
        db: dependencies.db,
        env: dependencies.env,
        now: dependencies.now(),
      },
    );

    if (result.status === "disabled" || result.status === "unavailable") {
      return Response.json(sanitizedUnavailableCheckout(result), {
        status: 409,
        headers: responseHeaders,
      });
    }

    if (result.status === "started" || result.status === "reused") {
      return Response.json(
        {
          status: result.status,
          checkoutUrl: result.checkoutUrl,
        },
        { headers: responseHeaders },
      );
    }

    return Response.json(
      { error: "trip_pass_checkout_unavailable" },
      { status: 409, headers: responseHeaders },
    );
  } catch {
    return Response.json(
      {
        error: "trip_pass_checkout_unavailable",
        message: "Trip Pass checkout could not be started.",
      },
      { status: 409, headers: responseHeaders },
    );
  }
}

async function ensureTripPassUser(dependencies: TripPassAccountRouteDependencies) {
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: dependencies.db,
    now: dependencies.now,
  });
}

function sanitizedUnavailableCheckout(result: Extract<TripPassCheckoutResult, { reason: string }>) {
  return {
    error: "trip_pass_checkout_unavailable",
    status: result.status,
    reason: result.status === "disabled" ? "checkout_disabled" : "checkout_unavailable",
  };
}

function isAllowedMutationOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin) {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    !fetchSite || fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none"
  );
}
