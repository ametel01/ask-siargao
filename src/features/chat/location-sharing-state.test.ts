import { describe, expect, test } from "bun:test";

import {
  type LocationSharingAction,
  type LocationSharingState,
  locationGeolocationForRequest,
  locationSharingReducer,
  shouldCaptureLocationForPrompt,
} from "@/features/chat/location-sharing-state";
import type { ChatClientGeolocation } from "@/features/chat/saved-trip-client";

const geolocation = (consentScope: "single_request" | "trip_session"): ChatClientGeolocation => ({
  latitude: 9.8116,
  longitude: 126.1651,
  accuracyMeters: 25,
  capturedAt: "2026-07-12T01:23:45.000Z",
  consentScope,
});

function reduce(
  actions: LocationSharingAction[],
  initialState: LocationSharingState = { status: "off" },
) {
  return actions.reduce(locationSharingReducer, initialState);
}

describe("location sharing state", () => {
  test("moves through one-request capture and consumes the coordinate", () => {
    const ready = reduce([
      { type: "request", requestId: 1, scope: "single_request" },
      { type: "resolve", requestId: 1, geolocation: geolocation("single_request") },
    ]);

    expect(ready).toMatchObject({ status: "ready", scope: "single_request" });
    expect(locationGeolocationForRequest(ready)).toMatchObject({
      consentScope: "single_request",
      latitude: 9.8116,
    });
    expect(locationSharingReducer(ready, { type: "consume_request" })).toEqual({ status: "used" });
  });

  test("keeps trip-session coordinates until the traveler turns sharing off", () => {
    const ready = reduce([
      { type: "request", requestId: 2, scope: "trip_session" },
      { type: "resolve", requestId: 2, geolocation: geolocation("trip_session") },
      { type: "consume_request" },
      { type: "consume_request" },
    ]);

    expect(ready).toMatchObject({ status: "ready", scope: "trip_session" });
    expect(locationSharingReducer(ready, { type: "turn_off" })).toEqual({ status: "off" });
  });

  test("classifies denial, failures, unsupported browsers, and explicit retry", () => {
    expect(
      reduce([
        { type: "request", requestId: 3, scope: "single_request" },
        { type: "deny", requestId: 3 },
      ]),
    ).toEqual({ status: "blocked" });

    expect(
      reduce([
        { type: "request", requestId: 4, scope: "single_request" },
        { type: "fail", requestId: 4, reason: "position_unavailable" },
      ]),
    ).toEqual({ status: "unavailable", reason: "position_unavailable" });

    expect(
      reduce([
        { type: "request", requestId: 5, scope: "single_request" },
        { type: "fail", requestId: 5, reason: "unsupported" },
      ]),
    ).toEqual({ status: "unavailable", reason: "unsupported" });

    expect(
      locationSharingReducer(
        { status: "blocked" },
        { type: "request", requestId: 6, scope: "trip_session" },
      ),
    ).toEqual({ status: "requesting", requestId: 6, scope: "trip_session" });
  });

  test("suppresses duplicate requests and rejects stale callbacks", () => {
    const requesting = reduce([
      { type: "request", requestId: 7, scope: "single_request" },
      { type: "request", requestId: 8, scope: "trip_session" },
    ]);

    expect(requesting).toEqual({ status: "requesting", requestId: 7, scope: "single_request" });
    expect(
      locationSharingReducer(requesting, {
        type: "resolve",
        requestId: 8,
        geolocation: geolocation("trip_session"),
      }),
    ).toEqual(requesting);
    expect(
      locationSharingReducer(locationSharingReducer(requesting, { type: "turn_off" }), {
        type: "resolve",
        requestId: 7,
        geolocation: geolocation("single_request"),
      }),
    ).toEqual({ status: "off" });
  });

  test("captures only direct browser-relative prompts from off or used states", () => {
    for (const prompt of [
      "Will it rain today?",
      "What is open now?",
      "Plan my day",
      "Build an itinerary for tomorrow",
      "Where should we eat in General Luna?",
      "Surf near Cloud 9 today?",
      "Plan my Siargao day around my accommodation.",
    ]) {
      expect(shouldCaptureLocationForPrompt(prompt, { status: "off" }), prompt).toBe(false);
    }

    for (const prompt of [
      "What is open near me?",
      "Coffee around me",
      "Use my current location for food",
      "Where I am, what is close?",
    ]) {
      expect(shouldCaptureLocationForPrompt(prompt, { status: "off" }), prompt).toBe(true);
      expect(shouldCaptureLocationForPrompt(prompt, { status: "used" }), prompt).toBe(true);
    }

    expect(shouldCaptureLocationForPrompt("What is near me in Dapa?", { status: "off" })).toBe(
      false,
    );
    expect(shouldCaptureLocationForPrompt("What is open near me?", { status: "blocked" })).toBe(
      false,
    );
    expect(
      shouldCaptureLocationForPrompt("What is open near me?", {
        status: "unavailable",
        reason: "timeout",
      }),
    ).toBe(false);
  });
});
