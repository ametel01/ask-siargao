import { createHash, randomBytes } from "node:crypto";

import {
  normalizeSavedTripItem,
  normalizeSharedTripPlan,
  type SavedTripItem,
  type SharedTripPlan,
} from "@/server/trips/shared-trip-types";

type QueryResult<T> = { rows: T[] };

export type SharedTripStoreDatabase = {
  query<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
};

export type SavedTripRecord = {
  id: string;
  userId?: string;
  clientTripKeyHash: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SharedTripPlanCreationResult = {
  plan: SharedTripPlan;
  publicToken: string;
};

type SavedTripRow = {
  id: string;
  user_id: string | null;
  client_trip_key_hash: string;
  title: string;
  created_at: Date;
  updated_at: Date;
};

type SavedTripItemRow = {
  id: string;
  trip_id: string;
  kind: SavedTripItem["kind"];
  title: string;
  payload_json: SavedTripItem["payload"];
  sources_json: SavedTripItem["sources"];
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

type SharedTripPlanRow = {
  id: string;
  trip_id: string;
  title: string;
  item_ids_json: string[];
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function upsertSavedTrip(
  db: SharedTripStoreDatabase,
  {
    clientTripKey,
    id,
    now = new Date().toISOString(),
    title = "Siargao saved plan",
    userId,
  }: {
    id: string;
    clientTripKey: string;
    title?: string;
    userId?: string;
    now?: string;
  },
): Promise<SavedTripRecord> {
  const clientTripKeyHash = hashClientTripKey(clientTripKey);
  const result = await db.query<SavedTripRow>(
    `
      insert into saved_trips (
        id,
        user_id,
        client_trip_key_hash,
        title,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $5)
      on conflict (client_trip_key_hash) do update
      set
        title = excluded.title,
        user_id = coalesce(excluded.user_id, saved_trips.user_id),
        updated_at = excluded.updated_at
      returning id, user_id, client_trip_key_hash, title, created_at, updated_at
    `,
    [id, userId ?? null, clientTripKeyHash, title, now],
  );

  return savedTripRecordFromRow(requiredRow(result.rows, "saved trip"));
}

export async function upsertSavedTripItems(
  db: SharedTripStoreDatabase,
  {
    items,
    now = new Date().toISOString(),
    tripId,
  }: {
    tripId: string;
    items: readonly SavedTripItem[];
    now?: string;
  },
) {
  const results: SavedTripItem[] = [];

  for (const item of items) {
    const normalizedItem = normalizeSavedTripItem({
      ...item,
      tripId,
      updatedAt: now,
    });
    const result = await db.query<SavedTripItemRow>(
      `
        insert into saved_trip_items (
          id,
          trip_id,
          kind,
          title,
          payload_json,
          sources_json,
          created_at,
          updated_at,
          deleted_at
        )
        values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, null)
        on conflict (id) do update
        set
          trip_id = excluded.trip_id,
          kind = excluded.kind,
          title = excluded.title,
          payload_json = excluded.payload_json,
          sources_json = excluded.sources_json,
          updated_at = excluded.updated_at,
          deleted_at = null
        returning id, trip_id, kind, title, payload_json, sources_json, created_at, updated_at,
          deleted_at
      `,
      [
        normalizedItem.id,
        tripId,
        normalizedItem.kind,
        normalizedItem.title,
        JSON.stringify(normalizedItem.payload),
        JSON.stringify(normalizedItem.sources),
        normalizedItem.createdAt,
        normalizedItem.updatedAt,
      ],
    );
    results.push(savedTripItemFromRow(requiredRow(result.rows, "saved trip item")));
  }

  return results;
}

export async function listSavedTripItems(
  db: SharedTripStoreDatabase,
  { includeDeleted = false, tripId }: { tripId: string; includeDeleted?: boolean },
) {
  const result = await db.query<SavedTripItemRow>(
    `
      select id, trip_id, kind, title, payload_json, sources_json, created_at, updated_at,
        deleted_at
      from saved_trip_items
      where trip_id = $1
        and ($2::boolean or deleted_at is null)
      order by created_at asc, id asc
    `,
    [tripId, includeDeleted],
  );

  return result.rows.map(savedTripItemFromRow);
}

export async function removeSavedTripItem(
  db: SharedTripStoreDatabase,
  {
    itemId,
    now = new Date().toISOString(),
    tripId,
  }: { tripId: string; itemId: string; now?: string },
) {
  const result = await db.query<{ id: string }>(
    `
      update saved_trip_items
      set deleted_at = $3, updated_at = $3
      where trip_id = $1 and id = $2 and deleted_at is null
      returning id
    `,
    [tripId, itemId, now],
  );

  return result.rows.length > 0;
}

export async function createSharedTripPlan(
  db: SharedTripStoreDatabase,
  {
    expiresAt,
    id,
    itemIds,
    now = new Date().toISOString(),
    publicToken = generateShareToken(),
    title,
    tripId,
  }: {
    id: string;
    tripId: string;
    title: string;
    itemIds: readonly string[];
    expiresAt?: string;
    now?: string;
    publicToken?: string;
  },
): Promise<SharedTripPlanCreationResult> {
  const selectedItems = await listSelectedActiveItems(db, { itemIds, tripId });
  const selectedItemIds = selectedItems.map((item) => item.id);
  if (selectedItemIds.length !== new Set(itemIds).size) {
    throw new Error("Shared plans can only include active items from the selected trip.");
  }

  const publicTokenHash = hashPublicToken(publicToken);
  await db.query(
    `
      insert into shared_trip_plans (
        id,
        trip_id,
        public_token_hash,
        title,
        item_ids_json,
        expires_at,
        deleted_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6, null, $7, $7)
      on conflict (id) do update
      set
        public_token_hash = excluded.public_token_hash,
        title = excluded.title,
        item_ids_json = excluded.item_ids_json,
        expires_at = excluded.expires_at,
        deleted_at = null,
        updated_at = excluded.updated_at
    `,
    [id, tripId, publicTokenHash, title, JSON.stringify(selectedItemIds), expiresAt ?? null, now],
  );

  return {
    publicToken,
    plan: normalizeSharedTripPlan({
      id,
      title,
      items: orderItemsByIds(selectedItems, selectedItemIds),
      createdAt: now,
      ...(expiresAt ? { expiresAt } : {}),
    }),
  };
}

export async function lookupSharedTripPlanByToken(
  db: SharedTripStoreDatabase,
  { now = new Date().toISOString(), publicToken }: { publicToken: string; now?: string },
) {
  const result = await db.query<SharedTripPlanRow>(
    `
      select id, trip_id, title, item_ids_json, expires_at, created_at, updated_at
      from shared_trip_plans
      where public_token_hash = $1
        and deleted_at is null
        and (expires_at is null or expires_at > $2)
      limit 1
    `,
    [hashPublicToken(publicToken), now],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const selectedItems = await listSelectedActiveItems(db, {
    tripId: row.trip_id,
    itemIds: row.item_ids_json,
  });

  return normalizeSharedTripPlan({
    id: row.id,
    title: row.title,
    items: orderItemsByIds(selectedItems, row.item_ids_json),
    createdAt: row.created_at.toISOString(),
    ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
  });
}

export async function deleteSharedTripPlanByToken(
  db: SharedTripStoreDatabase,
  { now = new Date().toISOString(), publicToken }: { publicToken: string; now?: string },
) {
  const result = await db.query<{ id: string }>(
    `
      update shared_trip_plans
      set deleted_at = $2, updated_at = $2
      where public_token_hash = $1 and deleted_at is null
      returning id
    `,
    [hashPublicToken(publicToken), now],
  );

  return result.rows.length > 0;
}

export function hashClientTripKey(clientTripKey: string) {
  return hashSecret(clientTripKey);
}

export function hashPublicToken(publicToken: string) {
  return hashSecret(publicToken);
}

export function generateShareToken() {
  return randomBytes(32).toString("base64url");
}

async function listSelectedActiveItems(
  db: SharedTripStoreDatabase,
  { itemIds, tripId }: { tripId: string; itemIds: readonly string[] },
) {
  if (itemIds.length === 0) {
    return [];
  }

  const result = await db.query<SavedTripItemRow>(
    `
      select id, trip_id, kind, title, payload_json, sources_json, created_at, updated_at,
        deleted_at
      from saved_trip_items
      where trip_id = $1
        and deleted_at is null
        and id = any($2::text[])
    `,
    [tripId, [...new Set(itemIds)]],
  );

  return result.rows.map(savedTripItemFromRow);
}

function savedTripRecordFromRow(row: SavedTripRow): SavedTripRecord {
  return {
    id: row.id,
    ...(row.user_id ? { userId: row.user_id } : {}),
    clientTripKeyHash: row.client_trip_key_hash,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function savedTripItemFromRow(row: SavedTripItemRow): SavedTripItem {
  const payload = row.payload_json;
  const sources = row.sources_json;
  return normalizeSavedTripItem({
    id: row.id,
    tripId: row.trip_id,
    kind: row.kind,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    payload,
    sources,
    ...savedItemDisplayFields(payload),
  });
}

function savedItemDisplayFields(payload: SavedTripItem["payload"]) {
  if (payload.type === "recommendation_card") {
    return {
      ...(payload.card.mapsUrl ? { mapsUrl: payload.card.mapsUrl } : {}),
      caveats: payload.card.caveats,
    };
  }

  if (payload.type === "itinerary_plan") {
    return {
      caveats: [
        ...payload.plan.skip,
        ...payload.plan.stops.flatMap((stop) => stop.caveats),
        ...payload.plan.fallbackStops.flatMap((stop) => stop.caveats),
      ],
    };
  }

  return { caveats: [] };
}

function orderItemsByIds(items: readonly SavedTripItem[], itemIds: readonly string[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return itemIds.flatMap((itemId) => {
    const item = itemById.get(itemId);
    return item ? [item] : [];
  });
}

function requiredRow<T>(rows: readonly T[], label: string) {
  const row = rows[0];
  if (!row) {
    throw new Error(`Expected ${label} row.`);
  }
  return row;
}

function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}
