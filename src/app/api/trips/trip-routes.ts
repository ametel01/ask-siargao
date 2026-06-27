import { z } from "zod";

import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  createSharedTripPlan,
  generateShareToken,
  listSavedTripItems,
  lookupSharedTripPlanByToken,
  removeSavedTripItem,
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
  db: SharedTripStoreDatabase;
  now: () => Date;
  createId: (prefix: string) => string;
  createPublicToken: () => string;
};

const deleteSavedTripItemRequestSchema = z
  .object({
    tripId: localTripIdSchema,
  })
  .strict();

export function createDefaultTripRouteDependencies(): TripRouteDependencies {
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

  const trip = await upsertSavedTrip(dependencies.db, {
    id: savedTripRecordId(parsed.data.tripId),
    clientTripKey: parsed.data.tripId,
    now: dependencies.now().toISOString(),
  });
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

  const removed = await removeSavedTripItem(dependencies.db, {
    tripId: savedTripRecordId(parsed.data.tripId),
    itemId,
    now: dependencies.now().toISOString(),
  });

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
    const result = await createSharedTripPlan(dependencies.db, {
      id: dependencies.createId("shared_trip"),
      tripId: savedTripRecordId(parsed.data.tripId),
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
  } catch (error) {
    return Response.json(
      {
        error: "shared_trip_not_available",
        message: error instanceof Error ? error.message : "Shared trip could not be created.",
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
  const parsed = localTripIdSchema.safeParse(url.searchParams.get("tripId"));
  if (!parsed.success) {
    return invalidTripRequest("invalid_saved_trip_request", [
      { path: "tripId", message: "Expected a valid tripId query parameter." },
    ]);
  }

  await upsertSavedTrip(dependencies.db, {
    id: savedTripRecordId(parsed.data),
    clientTripKey: parsed.data,
    now: dependencies.now().toISOString(),
  });
  const items = await listSavedTripItems(dependencies.db, {
    tripId: savedTripRecordId(parsed.data),
  });

  return Response.json({ tripId: parsed.data, items }, { headers });
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

function savedTripRecordId(clientTripKey: string) {
  return `saved_trip_${hashString(clientTripKey).slice(0, 32)}`;
}

function hashString(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
