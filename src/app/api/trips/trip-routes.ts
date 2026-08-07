import { z } from "zod";

import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  createSharedTripPlan,
  generateShareToken,
  hashClientTripKey,
  listSavedTripItems,
  lookupLatestSavedTripByUserId,
  lookupSavedTripByClientTripKey,
  lookupSavedTripById,
  lookupSharedTripPlanByToken,
  removeSavedTripItem,
  removeSavedTripItemByUserId,
  type SavedTripRecord,
  type SharedTripStoreDatabase,
  upsertSavedTrip,
  upsertSavedTripItems,
} from "@/server/trips/shared-trip-store";
import {
  createSharedTripPlanRequestSchema,
  localTripIdSchema,
  saveSavedTripItemsRequestSchema,
} from "@/server/trips/shared-trip-types";

export type TripRouteDependencies = {
  auth?: EnsureCurrentUserDependencies["auth"];
  db: SharedTripStoreDatabase;
  now: () => Date;
  createId: (prefix: string) => string;
  createPublicToken: () => string;
};

const deleteSavedTripItemRequestSchema = z.strictObject({
  tripId: localTripIdSchema.optional(),
});

function createDefaultTripRouteDependencies(): TripRouteDependencies {
  return {
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
    createId: (prefix) => `${prefix}_${crypto.randomUUID()}`,
    createPublicToken: generateShareToken,
  };
}

export async function savedTripsResponse(
  request: Request,
  dependencies: TripRouteDependencies = createDefaultTripRouteDependencies(),
  headers?: HeadersInit,
) {
  if (request.method === "GET") {
    return listSavedTripsResponse(request, dependencies, headers);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidTripRequest("invalid_saved_trip_request", [
      { path: "", message: "Expected a valid JSON request body." },
    ]);
  }

  const parsed = saveSavedTripItemsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidTripRequest(
      "invalid_saved_trip_request",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const currentUser = await resolveTripUser(dependencies);
  let trip: SavedTripRecord;
  try {
    trip =
      (currentUser
        ? await lookupOwnedSavedTripById(dependencies, parsed.data.tripId, currentUser.userId)
        : null) ??
      (await upsertSavedTrip(dependencies.db, {
        id: savedTripRecordId(parsed.data.tripId),
        clientTripKey: parsed.data.tripId,
        userId: currentUser?.userId,
        now: dependencies.now().toISOString(),
      }));
  } catch {
    return savedTripNotFound(headers);
  }
  const items = await upsertSavedTripItems(dependencies.db, {
    tripId: trip.id,
    items: parsed.data.items,
    now: dependencies.now().toISOString(),
  });

  return Response.json(
    {
      tripId: parsed.data.tripId,
      items,
    },
    { headers },
  );
}

export async function deleteSavedTripItemResponse(
  request: Request,
  {
    dependencies = createDefaultTripRouteDependencies(),
    headers,
    itemId,
  }: {
    itemId: string;
    dependencies?: TripRouteDependencies;
    headers?: HeadersInit;
  },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidTripRequest("invalid_saved_trip_delete_request", [
      { path: "", message: "Expected a valid JSON request body." },
    ]);
  }

  const parsed = deleteSavedTripItemRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidTripRequest(
      "invalid_saved_trip_delete_request",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const currentUser = await resolveTripUser(dependencies);
  if (!currentUser && !parsed.data.tripId) {
    return invalidTripRequest("invalid_saved_trip_delete_request", [
      { path: "tripId", message: "Expected a valid tripId field." },
    ]);
  }

  let removed = false;
  if (currentUser && !parsed.data.tripId) {
    removed = await removeSavedTripItemByUserId(dependencies.db, {
      userId: currentUser.userId,
      itemId,
      now: dependencies.now().toISOString(),
    });
  } else if (parsed.data.tripId) {
    const tripResult = await lookupSavedTripForRequest(dependencies, {
      currentUserId: currentUser?.userId ?? null,
      tripId: parsed.data.tripId,
    });
    if (tripResult.status === "denied") {
      return savedTripNotFound(headers);
    }
    const trip = tripResult.trip;
    removed = trip
      ? await removeSavedTripItem(dependencies.db, {
          tripId: trip.id,
          itemId,
          now: dependencies.now().toISOString(),
        })
      : false;
  }

  return Response.json({ removed }, { headers });
}

export async function createSharedTripResponse(
  request: Request,
  dependencies: TripRouteDependencies = createDefaultTripRouteDependencies(),
  headers?: HeadersInit,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidTripRequest("invalid_shared_trip_request", [
      { path: "", message: "Expected a valid JSON request body." },
    ]);
  }

  const parsed = createSharedTripPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidTripRequest(
      "invalid_shared_trip_request",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  try {
    const currentUser = await resolveTripUser(dependencies);
    const tripResult = await lookupSavedTripForRequest(dependencies, {
      currentUserId: currentUser?.userId ?? null,
      tripId: parsed.data.tripId,
    });
    if (tripResult.status === "denied") {
      return savedTripNotFound(headers);
    }
    const trip = tripResult.trip;
    if (!trip) {
      throw new Error("Saved trip could not be found for sharing.");
    }

    const result = await createSharedTripPlan(dependencies.db, {
      id: dependencies.createId("shared_trip"),
      tripId: trip.id,
      title: parsed.data.title ?? "Siargao saved plan",
      itemIds: parsed.data.itemIds,
      expiresAt: parsed.data.expiresAt,
      now: dependencies.now().toISOString(),
      publicToken: dependencies.createPublicToken(),
    });
    const shareUrl = new URL(`/trips/shared/${result.publicToken}`, request.url);

    return Response.json(
      {
        token: result.publicToken,
        shareUrl: shareUrl.toString(),
        plan: result.plan,
      },
      { headers },
    );
  } catch {
    return Response.json(
      {
        error: "shared_trip_not_available",
        message: "Shared trip could not be created.",
      },
      { status: 409, headers },
    );
  }
}

export async function sharedTripTokenResponse(
  _request: Request,
  {
    dependencies = createDefaultTripRouteDependencies(),
    headers,
    token,
  }: {
    token: string;
    dependencies?: TripRouteDependencies;
    headers?: HeadersInit;
  },
) {
  const plan = await lookupSharedTripPlanByToken(dependencies.db, {
    publicToken: token,
    now: dependencies.now().toISOString(),
  });

  if (!plan) {
    return Response.json({ error: "shared_trip_not_found" }, { status: 404, headers });
  }

  return Response.json({ plan }, { headers });
}

async function listSavedTripsResponse(
  request: Request,
  dependencies: TripRouteDependencies,
  headers?: HeadersInit,
) {
  const url = new URL(request.url);
  const currentUser = await resolveTripUser(dependencies);
  const tripId = url.searchParams.get("tripId");
  if (currentUser && !tripId) {
    const trip = await lookupLatestSavedTripByUserId(dependencies.db, {
      userId: currentUser.userId,
    });
    const items = trip ? await listSavedTripItems(dependencies.db, { tripId: trip.id }) : [];
    return Response.json({ tripId: trip?.id, items }, { headers });
  }

  const parsed = localTripIdSchema.safeParse(tripId);
  if (!parsed.success) {
    return invalidTripRequest("invalid_saved_trip_request", [
      { path: "tripId", message: "Expected a valid tripId query parameter." },
    ]);
  }

  const tripResult = await lookupSavedTripForRequest(dependencies, {
    currentUserId: currentUser?.userId ?? null,
    tripId: parsed.data,
  });
  if (tripResult.status === "denied") {
    return savedTripNotFound(headers);
  }
  const trip = tripResult.trip;
  const items = trip ? await listSavedTripItems(dependencies.db, { tripId: trip.id }) : [];

  return Response.json({ tripId: parsed.data, items }, { headers });
}

async function lookupSavedTripForRequest(
  dependencies: TripRouteDependencies,
  input: { tripId: string; currentUserId: string | null },
): Promise<{ status: "ok"; trip: SavedTripRecord | null } | { status: "denied" }> {
  if (input.currentUserId) {
    const byId = await lookupSavedTripById(dependencies.db, { tripId: input.tripId });
    if (byId) {
      return byId.userId === input.currentUserId
        ? { status: "ok", trip: byId }
        : { status: "denied" };
    }
  }

  const byClientKey = await lookupSavedTripByClientTripKey(dependencies.db, {
    clientTripKey: input.tripId,
  });
  if (byClientKey?.userId && byClientKey.userId !== input.currentUserId) {
    return { status: "denied" };
  }

  return { status: "ok", trip: byClientKey };
}

async function lookupOwnedSavedTripById(
  dependencies: TripRouteDependencies,
  tripId: string,
  userId: string,
) {
  const trip = await lookupSavedTripById(dependencies.db, { tripId });
  if (!trip) {
    return null;
  }
  if (trip.userId !== userId) {
    throw new Error("Saved trip belongs to another user.");
  }
  return trip;
}

async function resolveTripUser(dependencies: TripRouteDependencies) {
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: dependencies.db,
    now: dependencies.now,
  });
}

function invalidTripRequest(error: string, issues: Array<{ path: string; message: string }>) {
  return Response.json(
    {
      error,
      issues,
    },
    { status: 400 },
  );
}

function savedTripNotFound(headers?: HeadersInit) {
  return Response.json({ error: "saved_trip_not_found" }, { status: 404, headers });
}

function savedTripRecordId(clientTripKey: string) {
  return `saved_trip_${hashClientTripKey(clientTripKey)}`;
}
