import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { clerkProtectedRoutePatterns } from "@/server/auth/clerk-route-policy";

const isProtectedRoute = createRouteMatcher([...clerkProtectedRoutePatterns]);

const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

export default isClerkServerConfigured ? clerkProxy : () => NextResponse.next();

export const config = {
  matcher: [
    "/profile(.*)",
    "/chat/history(.*)",
    "/api/me(.*)",
    "/api/chat/threads(.*)",
    "/api/chat/ratings(.*)",
  ],
};
