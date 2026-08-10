import {
  authorizeVercelCron,
  cronJson,
  cronUnauthorized,
  runMonitoredOperationalCron,
} from "@/server/operations/vercel-cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeVercelCron(request)) {
    return cronUnauthorized();
  }
  const result = await runMonitoredOperationalCron();
  return cronJson(result, result.schedules.ok ? 200 : 503);
}
