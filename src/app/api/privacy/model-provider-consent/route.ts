import { z } from "zod";

import {
  hasModelProviderConsent,
  modelProviderConsentCookie,
  modelProviderConsentVersion,
} from "@/lib/model-provider-consent";
import { isAllowedMutationOrigin } from "@/server/security/request-origin";

const consentSchema = z.strictObject({
  consentVersion: z.literal(modelProviderConsentVersion),
});

export async function GET(request: Request) {
  return Response.json(
    { consented: hasModelProviderConsent(request.headers.get("cookie")) },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isAllowedMutationOrigin(request)) {
    return Response.json(
      { error: "invalid_request_origin" },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidConsentRequest();
  }

  if (!consentSchema.safeParse(body).success) {
    return invalidConsentRequest();
  }

  return Response.json(
    { consentVersion: modelProviderConsentVersion },
    {
      headers: {
        "cache-control": "private, no-store",
        "set-cookie": modelProviderConsentCookie({
          secure: new URL(request.url).protocol === "https:",
        }),
      },
    },
  );
}

function invalidConsentRequest() {
  return Response.json(
    { error: "invalid_model_provider_consent" },
    { status: 400, headers: { "cache-control": "private, no-store" } },
  );
}
