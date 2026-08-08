import { getProviderReleaseCandidateResponse } from "@/app/api/me/provider-release-candidate/provider-release-candidate-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return getProviderReleaseCandidateResponse();
}
