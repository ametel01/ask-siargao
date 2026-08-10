import {
  authorizeVercelCron,
  cronJson,
  cronUnauthorized,
  runOperationalCron,
} from "@/server/operations/vercel-cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeVercelCron(request)) {
    return cronUnauthorized();
  }
  return cronJson(await runOperationalCron());
}
