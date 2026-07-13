import type { ChatClientGeolocation } from "@/features/chat/saved-trip-client";

export type LocationSharingScope = ChatClientGeolocation["consentScope"];

export type LocationSharingState =
  | { status: "off" }
  | { status: "requesting"; requestId: number; scope: LocationSharingScope }
  | { status: "ready"; geolocation: ChatClientGeolocation; scope: LocationSharingScope }
  | { status: "blocked" }
  | { status: "unavailable"; reason: "unsupported" | "position_unavailable" | "timeout" }
  | { status: "used" };

export type LocationSharingAction =
  | { type: "request"; requestId: number; scope: LocationSharingScope }
  | { type: "resolve"; geolocation: ChatClientGeolocation; requestId: number }
  | { type: "deny"; requestId: number }
  | { type: "fail"; reason: "unsupported" | "position_unavailable" | "timeout"; requestId: number }
  | { type: "turn_off" }
  | { type: "consume_request" };

export function locationSharingReducer(
  state: LocationSharingState,
  action: LocationSharingAction,
): LocationSharingState {
  switch (action.type) {
    case "request":
      if (state.status === "requesting") {
        return state;
      }
      return { status: "requesting", requestId: action.requestId, scope: action.scope };
    case "resolve":
      if (state.status !== "requesting" || state.requestId !== action.requestId) {
        return state;
      }
      return {
        status: "ready",
        geolocation: action.geolocation,
        scope: action.geolocation.consentScope,
      };
    case "deny":
      if (state.status !== "requesting" || state.requestId !== action.requestId) {
        return state;
      }
      return { status: "blocked" };
    case "fail":
      if (state.status !== "requesting" || state.requestId !== action.requestId) {
        return state;
      }
      return { status: "unavailable", reason: action.reason };
    case "turn_off":
      return { status: "off" };
    case "consume_request":
      if (state.status === "ready" && state.scope === "single_request") {
        return { status: "used" };
      }
      return state;
  }
}

export function locationGeolocationForRequest(
  state: LocationSharingState,
): ChatClientGeolocation | undefined {
  return state.status === "ready" ? state.geolocation : undefined;
}

export function locationStateLabel(state: LocationSharingState) {
  switch (state.status) {
    case "off":
      return "Off";
    case "requesting":
      return "Requesting";
    case "ready":
      return state.scope === "trip_session" ? "On for this trip" : "Ready for one question";
    case "blocked":
      return "Blocked";
    case "unavailable":
      return "Unavailable";
    case "used":
      return "Used";
  }
}
