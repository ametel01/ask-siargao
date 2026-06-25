import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { type ChatRouteDependencies, chatResponse } from "@/app/api/chat/chat-route";
import {
  type AnswerContext,
  type AnswerContextRequest,
  AnswerContextStore,
} from "@/server/chat/answer-context-store";
import { runInitialMigration } from "@/server/db/test-database";
import { googlePlacesChatSearchFieldMask } from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  createGooglePlaceSnapshotInput,
  type GooglePlaceDetailsInput,
  type GooglePlaceIdentityInput,
  type GooglePlacesSourceRecordInput,
  type GooglePlacesStoreDatabase,
  upsertGooglePlaceDetails,
  upsertGooglePlaceReviews,
} from "@/server/providers/google-places-store";
import type { OpenMeteoForecastLocation } from "@/server/providers/open-meteo";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

describe("chat route", () => {
  test("rejects malformed JSON request bodies", async () => {
    const response = await chatResponse(rawRequest("{"), chatDependencies());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_json");
  });

  test("rejects requests without messages", async () => {
    const response = await chatResponse(jsonRequest({ messages: [] }), chatDependencies());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_chat_request");
    expect(body.issues[0].path).toBe("messages");
  });

  test("politely declines clearly unrelated questions without calling the model", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Can you write Python code for a stock bot?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("I can only help with Siargao");
    expect(dependencies.requests).toHaveLength(0);
    expect(dependencies.weatherRequests).toBe(0);
    expect(dependencies.answerContextRequests).toHaveLength(0);
  });

  test("returns an Ask Siargao model response", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Cloud 9");
    expect(body.model).toBe("gpt-5.5");
    expect(dependencies.requests[0]?.messages[0]?.content).toBe(
      "Where should we eat near Cloud 9?",
    );
  });

  test("passes DB-first answer context to restaurant recommendation questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "find me the best restaurant around cloud9" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.answerContextRequests).toHaveLength(1);
    expect(dependencies.answerContextRequests[0]?.userMessageId).toMatch(/^request_user_message_/);
    expect(dependencies.requests[0]?.answerContext?.sourceFreshness[0]?.sourceName).toBe(
      "Google Places",
    );
    expect(dependencies.requests[0]?.answerContext?.facts[0]?.claim).toContain("Kermit");
  });

  test("uses fresh stored Google facts through AnswerContextStore without provider calls", async () => {
    const db = await openRouteGooglePlacesTestDatabase();
    await seedRouteStoredPlace(db, {
      fetchedAt: "2026-06-25T00:00:00.000Z",
      retentionExpiresAt: "2026-07-25T00:00:00.000Z",
      staleAt: "2026-07-02T00:00:00.000Z",
    });
    const requests: Parameters<ChatRouteDependencies["generateAskSiargaoChatResponse"]>[0][] = [];
    let googleCalls = 0;
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      {
        generateAskSiargaoChatResponse: async (request) => {
          requests.push(request);
          return {
            message: "Use the fresh stored Google facts for Kermit near Cloud 9.",
            model: "gpt-5.5",
            requestId: "req_db_first_chat_test",
          };
        },
        answerContextStore: new AnswerContextStore({
          db,
          clock: () => new Date("2026-06-28T00:00:00.000Z"),
          googlePlacesAdapter: async () => {
            googleCalls += 1;
            throw new Error("Fresh DB data should avoid live Google calls.");
          },
        }),
      },
    );
    const body = await response.json();
    const serializedRequest = JSON.stringify(requests[0]);

    expect(response.status).toBe(200);
    expect(body.message).toContain("fresh stored Google facts");
    expect(googleCalls).toBe(0);
    expect(requests[0]?.answerContext?.liveRefreshCount).toBe(0);
    expect(requests[0]?.answerContext?.sourceFreshness[0]).toMatchObject({
      sourceName: "Google Places",
      status: "fresh",
    });
    expect(requests[0]?.answerContext?.facts.map((fact) => fact.type)).toContain(
      "google_rating_signal",
    );
    expect(serializedRequest).not.toContain("EXPIRED_REVIEW_TEXT_SHOULD_NOT_LEAK");
    expect(serializedRequest).not.toContain("RAW_GOOGLE_PAYLOAD_SHOULD_NOT_LEAK");

    await db.close();
  });

  test("passes Google Places gaps through /api/chat when stored data is missing and refresh is blocked", async () => {
    const db = await openRouteGooglePlacesTestDatabase();
    const requests: Parameters<ChatRouteDependencies["generateAskSiargaoChatResponse"]>[0][] = [];
    let googleCalls = 0;
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "find me the best restaurant around cloud9" }],
      }),
      {
        generateAskSiargaoChatResponse: async (request) => {
          requests.push(request);
          return {
            message:
              "I could not refresh Google Places for this request, so I will avoid live claims.",
            model: "gpt-5.5",
            requestId: "req_gap_chat_test",
          };
        },
        answerContextStore: new AnswerContextStore({
          db,
          canUseLiveRefresh: () => false,
          clock: () => new Date("2026-06-28T00:00:00.000Z"),
          googlePlacesAdapter: async () => {
            googleCalls += 1;
            throw new Error("Blocked refresh should not call Google.");
          },
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("could not refresh Google Places");
    expect(googleCalls).toBe(0);
    expect(requests[0]?.answerContext?.facts).toHaveLength(0);
    expect(requests[0]?.answerContext?.gaps[0]).toMatchObject({
      type: "google_places",
      reason: "refresh_blocked",
    });
    expect(requests[0]?.answerContext?.sourceFreshness[0]).toMatchObject({
      sourceName: "Google Places",
      status: "blocked",
    });

    await db.close();
  });

  test("passes the Siargao weather snapshot to weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What's the weather today in Siargao?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.requests[0]?.weatherContext?.sourceProfileId).toBe("source_open_meteo");
    expect(dependencies.requests[0]?.weatherContext?.summary).toContain("Open-Meteo");
  });

  test("uses the Del Carmen forecast location for Del Carmen weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "What's the weather today in Siargao Del Carmen area?" },
        ],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.weatherLocations[0]?.id).toBe("siargao_del_carmen");
    expect(dependencies.weatherLocations[0]?.name).toContain("Del Carmen");
  });

  test("does not fetch weather context for non-weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(0);
    expect(dependencies.requests[0]?.weatherContext).toBeUndefined();
  });

  test("does not fetch answer context for ordinary chat", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "How many nights should we stay in Siargao?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.answerContextRequests).toHaveLength(0);
    expect(dependencies.requests[0]?.answerContext).toBeUndefined();
  });

  test("returns stable unavailable response when OpenAI is not configured", async () => {
    const response = await chatResponse(
      jsonRequest({ messages: [{ role: "user", content: "Hi" }] }),
      {
        generateAskSiargaoChatResponse: async () => {
          throw new Error("OPENAI_API_KEY is required for Ask Siargao chat.");
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("chat_not_configured");
  });
});

function chatDependencies() {
  const requests: Parameters<ChatRouteDependencies["generateAskSiargaoChatResponse"]>[0][] = [];
  const dependencies: ChatRouteDependencies & {
    requests: typeof requests;
    answerContextRequests: AnswerContextRequest[];
    weatherLocations: OpenMeteoForecastLocation[];
    weatherRequests: number;
  } = {
    generateAskSiargaoChatResponse: async (request) => {
      requests.push(request);
      return {
        message: "Near Cloud 9, start with Kermit, Shaka, or Bravo depending on your budget.",
        model: request.model ?? "gpt-5.5",
        requestId: "req_chat_test",
      };
    },
    getLatestSiargaoWeatherSnapshot: async (options) => {
      dependencies.weatherRequests += 1;
      if (options?.location) {
        dependencies.weatherLocations.push(options.location);
      }
      return fallbackWeatherSnapshot;
    },
    answerContextStore: {
      getOrRefresh: async (request) => {
        dependencies.answerContextRequests.push(request);
        return answerContextFixture;
      },
    },
    requests,
    answerContextRequests: [],
    weatherLocations: [],
    weatherRequests: 0,
  };

  return dependencies;
}

const answerContextFixture: AnswerContext = {
  facts: [
    {
      id: "answer_fact_place_kermit_place",
      type: "place_candidate",
      claim: "Kermit Surf Resort and Restaurant is a Google Places candidate for this request.",
      sourceRecordIds: ["record_google_places_chat_place_kermit"],
      requiresGoogleAttribution: true,
    },
  ],
  evidence: [],
  gaps: [],
  sourceFreshness: [
    {
      sourceName: "Google Places",
      status: "fresh",
      fetchedAt: "2026-06-24T00:00:00.000Z",
      staleAt: "2026-07-01T00:00:00.000Z",
      retentionExpiresAt: "2026-07-24T00:00:00.000Z",
    },
  ],
  liveRefreshCount: 0,
  estimatedProviderCostUsd: 0,
};

async function openRouteGooglePlacesTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  await db.query(`
    insert into providers (id, slug, name, provider_type)
    values ('provider_google_places', 'google-places', 'Google Places', 'places_api')
  `);
  await db.query(
    `
      insert into source_profiles (
        id,
        provider_id,
        source_name,
        source_type,
        access_method,
        allowed_use,
        freshness_window_days,
        authority_level,
        stores_raw_allowed,
        publishes_raw_allowed
      )
      values ($1, 'provider_google_places', 'Google Places', 'provider_api', 'api', 'citation_only', 7, 60, false, false)
    `,
    [googlePlacesDiscoverySourceProfileId],
  );
  return db;
}

async function seedRouteStoredPlace(
  db: GooglePlacesStoreDatabase,
  {
    fetchedAt,
    retentionExpiresAt,
    staleAt,
  }: {
    fetchedAt: string;
    staleAt: string;
    retentionExpiresAt: string;
  },
) {
  const place: GooglePlaceIdentityInput = {
    placeId: "place_kermit",
    resourceName: "places/place_kermit",
  };
  const sourceRecord: GooglePlacesSourceRecordInput = {
    id: "record_google_places_chat_place_kermit",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    providerEntityId: place.placeId,
    entityType: "restaurant",
    name: "Kermit Surf Resort and Restaurant",
    normalizedPayload: { placeId: place.placeId },
    sourceUrl: "https://maps.google.com/?cid=123",
    fetchedAt,
    allowedUse: "citation_only",
  };
  const snapshot = createGooglePlaceSnapshotInput({
    placeId: place.placeId,
    requestKind: "chat_search",
    fieldMask: googlePlacesChatSearchFieldMask,
    fetchedAt,
    payloadJson: {
      googleMapsUri: "https://maps.google.com/?cid=123",
      rawPayloadSentinel: "RAW_GOOGLE_PAYLOAD_SHOULD_NOT_LEAK",
    },
  });
  const details: GooglePlaceDetailsInput = {
    displayNameJson: { text: "Kermit Surf Resort and Restaurant" },
    formattedAddress: "Tourism Road, General Luna, Siargao",
    latitude: 9.803,
    longitude: 126.161,
    locationJson: { latitude: 9.803, longitude: 126.161 },
    typesJson: ["restaurant", "food"],
    primaryType: "restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=123",
    rating: 4.6,
    userRatingCount: 1240,
    priceLevel: "PRICE_LEVEL_MODERATE",
    fetchedAt,
    staleAt,
    retentionExpiresAt,
  };

  await upsertGooglePlaceDetails(db, {
    place,
    sourceRecord,
    snapshot: {
      ...snapshot,
      staleAt,
      retentionExpiresAt,
    },
    details,
  });
  await upsertGooglePlaceReviews(db, {
    place,
    sourceRecord,
    snapshot: {
      ...snapshot,
      staleAt,
      retentionExpiresAt,
    },
    reviews: [
      {
        id: "review_expired_route_test",
        fetchedAt: "2026-05-01T00:00:00.000Z",
        rating: 1,
        retentionExpiresAt: "2026-05-31T00:00:00.000Z",
        staleAt: "2026-05-08T00:00:00.000Z",
        textJson: { text: "EXPIRED_REVIEW_TEXT_SHOULD_NOT_LEAK" },
      },
    ],
  });
}

function jsonRequest(body: unknown) {
  return rawRequest(JSON.stringify(body));
}

function rawRequest(body: string) {
  return new Request("https://siargao.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
