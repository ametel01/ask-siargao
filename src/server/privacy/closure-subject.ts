import { createHmac } from "node:crypto";

export type ClosureSubjectHashPolicy = {
  tombstoneHashKey: string;
  tombstoneHashVersion: number;
  tombstonePreviousHashKeys?: ReadonlyArray<{ key: string; version: number }>;
};

const localTombstoneHashKey = "local-account-closure-tombstone-key";

export function closureSubjectHashCandidates(userId: string, policy: ClosureSubjectHashPolicy) {
  const configured = [
    { key: policy.tombstoneHashKey, version: policy.tombstoneHashVersion },
    ...(policy.tombstonePreviousHashKeys ?? []),
  ];
  const seen = new Set<number>();
  return configured.flatMap((candidate) => {
    if (seen.has(candidate.version)) return [];
    seen.add(candidate.version);
    return [closureSubjectHashCandidate(userId, candidate)];
  });
}

export function currentClosureSubjectHash(userId: string, policy: ClosureSubjectHashPolicy) {
  return closureSubjectHashCandidate(userId, {
    key: policy.tombstoneHashKey,
    version: policy.tombstoneHashVersion,
  });
}

export function readClosureSubjectHashPolicy(
  env: Record<string, string | undefined> = process.env,
): ClosureSubjectHashPolicy {
  const configuredKey = env.ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY?.trim();
  if (!configuredKey && env.NODE_ENV === "production") {
    throw new Error("ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY is required in production.");
  }
  const version = positiveVersion(
    env.ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY_VERSION,
    "ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY_VERSION",
    1,
  );
  return {
    tombstoneHashKey: configuredKey || localTombstoneHashKey,
    tombstoneHashVersion: version,
    tombstonePreviousHashKeys: readPreviousTombstoneKeys(
      env.ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON,
      version,
    ),
  };
}

function closureSubjectHashCandidate(userId: string, candidate: { key: string; version: number }) {
  return {
    hash: createHmac("sha256", candidate.key)
      .update(`clerk_user_id:${candidate.version}:${userId}`)
      .digest("base64url"),
    version: candidate.version,
  };
}

function positiveVersion(raw: string | undefined, name: string, fallback: number) {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readPreviousTombstoneKeys(raw: string | undefined, currentVersion: number) {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON must be a JSON object.");
  }
  return Object.entries(parsed).map(([version, key]) => {
    const numericVersion = Number(version);
    if (
      !Number.isInteger(numericVersion) ||
      numericVersion <= 0 ||
      numericVersion === currentVersion ||
      typeof key !== "string" ||
      !key.trim()
    ) {
      throw new Error(
        "ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON requires distinct positive version keys and non-empty secret values.",
      );
    }
    return { key, version: numericVersion };
  });
}
