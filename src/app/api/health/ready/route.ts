import { readyHealthResponse } from "@/server/operations/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return readyHealthResponse();
}
