import { liveHealthResponse } from "@/server/operations/health";

export const dynamic = "force-dynamic";

export function GET() {
  return liveHealthResponse();
}
