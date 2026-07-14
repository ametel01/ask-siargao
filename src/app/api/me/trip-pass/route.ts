import { getTripPassAccountResponse } from "@/app/api/me/trip-pass/trip-pass-route";

export const runtime = "nodejs";

export async function GET() {
  return getTripPassAccountResponse();
}
