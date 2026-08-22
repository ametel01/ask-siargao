import { serviceWorkerSource } from "./source";

export function GET() {
  return new Response(serviceWorkerSource, {
    headers: {
      "cache-control": "no-cache, no-store, must-revalidate",
      "content-security-policy": "default-src 'self'; connect-src 'self'; script-src 'self'",
      "content-type": "application/javascript; charset=utf-8",
      "service-worker-allowed": "/",
      "x-content-type-options": "nosniff",
    },
  });
}
