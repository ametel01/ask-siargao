import { postAccountClosureResponse } from "@/app/api/me/account-closure/account-closure-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return postAccountClosureResponse(request);
}
