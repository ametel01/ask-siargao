import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { decodeBase64Url, encodeBase64Url } from "@/features/field-security/encoding";

const payloadSchema = z.strictObject({
  accountId: z.string().min(1).max(200),
  challenge: z.string().min(20).max(200),
  expiresAtMs: z.number().int().positive(),
  version: z.literal(1),
});

export const fieldRegistrationChallengeCookie = "ask_siargao_field_registration";

export function createFieldRegistrationChallenge(input: {
  accountId: string;
  nowMs: number;
  secret: string;
}): { challenge: string; token: string } {
  requireChallengeSecret(input.secret);
  const challenge = encodeBase64Url(randomBytes(32));
  const payload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        accountId: input.accountId,
        challenge,
        expiresAtMs: input.nowMs + 10 * 60 * 1_000,
        version: 1,
      }),
    ),
  );
  return { challenge, token: `${payload}.${sign(payload, input.secret)}` };
}

export function verifyFieldRegistrationChallenge(input: {
  accountId: string;
  nowMs: number;
  secret: string;
  token: string;
}): string {
  requireChallengeSecret(input.secret);
  const [payload, signature, extra] = input.token.split(".");
  if (!payload || !signature || extra) throw new Error("field_registration_challenge_invalid");
  const expected = Buffer.from(sign(payload, input.secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("field_registration_challenge_invalid");
  }
  const parsed = payloadSchema.safeParse(
    JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))),
  );
  if (
    !parsed.success ||
    parsed.data.accountId !== input.accountId ||
    parsed.data.expiresAtMs <= input.nowMs
  ) {
    throw new Error("field_registration_challenge_invalid");
  }
  return parsed.data.challenge;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function requireChallengeSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) throw new Error("field_registration_not_configured");
}
