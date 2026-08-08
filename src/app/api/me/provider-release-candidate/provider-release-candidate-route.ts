import { auth } from "@clerk/nextjs/server";

type ReleaseCandidateProbeDependencies = {
  authenticate: () => Promise<{ userId: string | null }>;
  env: Record<string, string | undefined>;
};

const fullSha = /^[0-9a-f]{40}$/;

export async function getProviderReleaseCandidateResponse(
  dependencies: ReleaseCandidateProbeDependencies = {
    authenticate: auth,
    env: process.env,
  },
) {
  if (dependencies.env.CLERK_DEPLOYMENT_CONTEXT !== "protected-staging") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const { userId } = await dependencies.authenticate();
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const releaseCandidateSha = dependencies.env.VERCEL_GIT_COMMIT_SHA;
  if (!releaseCandidateSha || !fullSha.test(releaseCandidateSha)) {
    return Response.json({ error: "deployment_identity_unavailable" }, { status: 503 });
  }

  return Response.json(
    { releaseCandidateSha },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
