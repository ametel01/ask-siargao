import { createClerkClient } from "@clerk/backend";

import { createLiveProviderReleaseCandidateLifecycle } from "@/server/qa/provider-release-candidate-live-boundary";

const releaseEvidenceLifecycle = await createLiveProviderReleaseCandidateLifecycle("clerk");
const secretKey = required("CLERK_SECRET_KEY");
const closureEmail = requiredTestEmail("PROVIDER_RC_CLERK_CLOSURE_USER");

let remainingUsers: number;
try {
  const result = await createClerkClient({ secretKey }).users.getUserList({
    emailAddress: [closureEmail],
    limit: 2,
  });
  remainingUsers = result.totalCount;
} catch {
  throw new Error("The redacted Clerk deletion convergence lookup failed.");
}
if (remainingUsers !== 0) {
  throw new Error("The dedicated Clerk closure identity still exists after cleanup.");
}
await releaseEvidenceLifecycle.recordScenarios(["provider_user_deletion"]);

console.log(
  JSON.stringify({
    checkedOutCommitSha: required("PROVIDER_RC_EXPECTED_SHA"),
    deletionConverged: true,
    lane: "clerk",
  }),
);

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the protected Clerk lane.`);
  return value;
}

function requiredTestEmail(name: string) {
  const value = required(name);
  if (!value.includes("+clerk_test@"))
    throw new Error(`${name} must be a dedicated test identity.`);
  return value;
}
