import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

import type { ProviderReleaseCandidateLane } from "@/server/qa/provider-release-candidate";

const directory = ".tmp/provider-release-candidate";

export type ProviderReleaseCandidateDatabaseReceipt = {
  checkedOutCommitSha: string;
  deployedMigrationLedgerFingerprint: string;
  lane: ProviderReleaseCandidateLane;
  migrationCount: number;
  protectedDatabaseEnvironment: "protected-test";
};

export type ProviderReleaseCandidateFinalBoundaryReceipt = {
  checkedOutCommitSha: string;
  databaseFingerprint: string;
  deployedCommitMatched: true;
  lane: ProviderReleaseCandidateLane;
};

export async function recordExecutedProviderScenario(input: {
  checkedOutCommitSha: string;
  lane: ProviderReleaseCandidateLane;
  scenario: string;
}) {
  await mkdir(directory, { recursive: true });
  await appendFile(scenarioPath(input.lane, input.checkedOutCommitSha), `${input.scenario}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

export async function readExecutedProviderScenarios(
  lane: ProviderReleaseCandidateLane,
  checkedOutCommitSha: string,
) {
  const receipt = await readFile(scenarioPath(lane, checkedOutCommitSha), "utf8");
  return receipt.split("\n").filter(Boolean);
}

export async function writeProviderDatabaseReceipt(
  receipt: ProviderReleaseCandidateDatabaseReceipt,
) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    databasePath(receipt.lane, receipt.checkedOutCommitSha),
    JSON.stringify(receipt),
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
}

export async function readProviderDatabaseReceipt(
  lane: ProviderReleaseCandidateLane,
  checkedOutCommitSha: string,
) {
  return JSON.parse(
    await readFile(databasePath(lane, checkedOutCommitSha), "utf8"),
  ) as ProviderReleaseCandidateDatabaseReceipt;
}

export async function writeProviderFinalBoundaryReceipt(
  receipt: ProviderReleaseCandidateFinalBoundaryReceipt,
) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    finalBoundaryPath(receipt.lane, receipt.checkedOutCommitSha),
    JSON.stringify(receipt),
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
}

export async function readProviderFinalBoundaryReceipt(
  lane: ProviderReleaseCandidateLane,
  checkedOutCommitSha: string,
) {
  return JSON.parse(
    await readFile(finalBoundaryPath(lane, checkedOutCommitSha), "utf8"),
  ) as ProviderReleaseCandidateFinalBoundaryReceipt;
}

function scenarioPath(lane: ProviderReleaseCandidateLane, sha: string) {
  return `${directory}/${lane}-${sha}.scenarios`;
}

function databasePath(lane: ProviderReleaseCandidateLane, sha: string) {
  return `${directory}/${lane}-${sha}.database.json`;
}

function finalBoundaryPath(lane: ProviderReleaseCandidateLane, sha: string) {
  return `${directory}/${lane}-${sha}.final-boundary.json`;
}
