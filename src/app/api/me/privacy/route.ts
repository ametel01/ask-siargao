import { postPrivacyActionResponse } from "@/app/api/me/privacy/privacy-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return postPrivacyActionResponse(request);
}
