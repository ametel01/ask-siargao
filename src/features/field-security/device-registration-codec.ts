import { z } from "zod";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { fieldDeviceRoleSchema, publicJwkSchema } from "@/features/field-security/types";

export const fieldDeviceRegistrationPayloadSchema = z.strictObject({
  agreementPublicKey: publicJwkSchema,
  agreementPublicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  role: fieldDeviceRoleSchema,
  signingPublicKey: publicJwkSchema,
  signingPublicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.literal("field-device-registration.v1"),
});

export type FieldDeviceRegistrationPayload = z.input<typeof fieldDeviceRegistrationPayloadSchema>;

export interface FieldDeviceRegistrationCodec {
  decode(value: string): FieldDeviceRegistrationPayload;
  encode(payload: FieldDeviceRegistrationPayload): string;
}

export const canonicalFieldDeviceRegistrationCodec: FieldDeviceRegistrationCodec = {
  decode(value) {
    const parsed = fieldDeviceRegistrationPayloadSchema.safeParse(JSON.parse(value));
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) {
      throw new Error("field_device_registration_invalid");
    }
    return parsed.data as FieldDeviceRegistrationPayload;
  },
  encode(payload) {
    return canonicalStringify(fieldDeviceRegistrationPayloadSchema.parse(payload));
  },
};
