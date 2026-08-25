import { describe, expect, test } from "bun:test";

import { postRevokeFieldDeviceResponse } from "@/app/api/operator/field/devices/[deviceId]/revoke/revoke-route";
import { getFieldDevicesResponse } from "@/app/api/operator/field/devices/device-route";
import { postFieldGrantResponse } from "@/app/api/operator/field/grants/grant-route";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import type { DatabaseQueryClient, QueryResult } from "@/server/db/query-client";

describe("field security API boundaries", () => {
  test("denies cross-origin and non-reverified trust creation before database access", async () => {
    let queries = 0;
    const db = fakeDatabase(async () => {
      queries += 1;
      return { rows: [] };
    });
    const crossOrigin = await postFieldGrantResponse(
      new Request("https://asksiargao.com/api/operator/field/grants", {
        body: "{}",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        method: "POST",
      }),
      {
        allowlist: new Set(["researcher"]),
        auth: async () => ({ accountId: "researcher", mfaFresh: true }),
        db,
        now: () => new Date(),
        signing: () => {
          throw new Error("must_not_sign");
        },
      },
    );
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({ error: "invalid_request_origin" });

    const staleMfa = await postRevokeFieldDeviceResponse(
      sameOriginRequest("/api/operator/field/devices/field_device_1234567890123456/revoke"),
      "field_device_1234567890123456",
      {
        allowlist: new Set(["researcher"]),
        auth: async () => ({ accountId: "researcher", mfaFresh: false }),
        db,
        now: () => new Date(),
      },
    );
    expect(staleMfa.status).toBe(403);
    expect(await staleMfa.json()).toEqual({ error: "fresh_mfa_required" });
    expect(queries).toBe(0);
  });

  test("issues a signed 72-hour grant under a row lock with private no-store responses", async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.exportKey("jwk", keyPair.privateKey),
      crypto.subtle.exportKey("jwk", keyPair.publicKey),
    ]);
    const seenSql: string[] = [];
    const db = fakeDatabase(async (query) => {
      seenSql.push(query);
      if (query.includes("from field_authorized_devices")) {
        return {
          rows: [
            {
              role: "recorder",
              signing_public_key_fingerprint: "a".repeat(64),
              status: "active",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const response = await postFieldGrantResponse(
      sameOriginRequest("/api/operator/field/grants", {
        applicationBuildId: "build-239",
        applicationVersion: "0.1.0",
        deviceId: "field_device_1234567890123456",
        protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
        protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
      }),
      {
        allowlist: new Set(["researcher"]),
        auth: async () => ({ accountId: "researcher", mfaFresh: true }),
        db,
        now: () => new Date("2026-08-23T00:00:00.000Z"),
        signing: () => ({
          privateKey,
          publicKey,
          signerKeyId: "signer-1",
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as {
      grant: { claims: { expiresAt: string; issuedAt: string }; signature: string };
    };
    expect(Date.parse(body.grant.claims.expiresAt) - Date.parse(body.grant.claims.issuedAt)).toBe(
      72 * 60 * 60 * 1_000,
    );
    expect(body.grant.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(seenSql.some((query) => query.includes("for update"))).toBe(true);
  });

  test("lists only minimal active recipient public metadata", async () => {
    const response = await getFieldDevicesResponse(
      new Request("https://asksiargao.com/api/operator/field/devices"),
      {
        allowlist: new Set(["researcher"]),
        auth: async () => ({ accountId: "researcher", mfaFresh: false }),
        challengeSecret: "x".repeat(32),
        db: fakeDatabase(async () => ({
          rows: [
            {
              agreement_public_key: { crv: "P-256", kty: "EC", x: "x", y: "y" },
              agreement_public_key_fingerprint: "b".repeat(64),
              id: "field_device_1234567890123456",
              role: "desk",
              signing_public_key: { crv: "P-256", kty: "EC", x: "x", y: "y" },
              signing_public_key_fingerprint: "a".repeat(64),
            },
          ],
        })),
        now: () => new Date(),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("accountId");
    expect(body).not.toContain("webauthn");
  });
});

function sameOriginRequest(path: string, body: unknown = {}) {
  return new Request(`https://asksiargao.com${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "https://asksiargao.com",
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

function fakeDatabase(
  query: (query: string, params?: unknown[]) => Promise<QueryResult<Record<string, unknown>>>,
): DatabaseQueryClient {
  const db: DatabaseQueryClient = {
    inTransaction: false,
    query: query as DatabaseQueryClient["query"],
    transaction: async (callback) =>
      callback({
        inTransaction: true,
        query: query as DatabaseQueryClient["query"],
      }),
  };
  return db;
}
