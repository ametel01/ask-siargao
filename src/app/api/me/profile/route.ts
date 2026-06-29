import { getProfileResponse, patchProfileResponse } from "@/app/api/me/profile/profile-route";

export const runtime = "nodejs";

export async function GET() {
  return getProfileResponse();
}

export async function PATCH(request: Request) {
  return patchProfileResponse(request);
}
