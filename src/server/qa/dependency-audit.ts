export type DependencyAuditException = {
  advisoryId: string;
  expiresAt: string;
};

export const dependencyAuditExceptions: readonly DependencyAuditException[] = [];

export function activeDependencyAuditExceptionIds(
  now = new Date(),
  exceptions: readonly DependencyAuditException[] = dependencyAuditExceptions,
) {
  for (const exception of exceptions) {
    const expiresAt = new Date(exception.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new Error(
        `Dependency-audit exception ${exception.advisoryId} expired at ${exception.expiresAt}.`,
      );
    }
  }
  return exceptions.map((exception) => exception.advisoryId);
}

async function main() {
  const ignoredAdvisories = activeDependencyAuditExceptionIds();
  const audit = Bun.spawn(
    [
      "bun",
      "audit",
      "--audit-level=high",
      ...ignoredAdvisories.flatMap((advisoryId) => ["--ignore", advisoryId]),
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await audit.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  await main();
}
