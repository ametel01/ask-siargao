import { describe, expect, test } from "bun:test";

import {
  type DeploymentCommandRunner,
  runStagingDeployment,
} from "@/server/deployment/staging-deployment";

const sha = "a".repeat(40);
const deploymentHost = "ask-siargao-staging-test-ametel01s-projects.vercel.app";

describe("staging deployment command", () => {
  test("deploys only the trusted main candidate and promotes it after READY", async () => {
    const commands: string[][] = [];
    const messages: string[] = [];
    const result = await runStagingDeployment({
      log: (message) => messages.push(message),
      run: commandRunner(commands, [
        "",
        "main\n",
        "",
        `${sha}\n`,
        `${sha}\n`,
        `https://${deploymentHost}\n`,
        JSON.stringify({ readyState: "READY", target: "staging", url: deploymentHost }),
        "Success!\n",
      ]),
    });

    expect(commands).toEqual([
      ["git", "status", "--porcelain"],
      ["git", "branch", "--show-current"],
      ["git", "fetch", "upstream", "main"],
      ["git", "rev-parse", "HEAD"],
      ["git", "rev-parse", "upstream/main"],
      [
        "vercel",
        "deploy",
        "--target",
        "staging",
        "--project",
        "ask-siargao",
        "--scope",
        "ametel01s-projects",
        "--yes",
        "--no-wait",
      ],
      [
        "vercel",
        "inspect",
        deploymentHost,
        "--wait",
        "--timeout",
        "10m",
        "--json",
        "--scope",
        "ametel01s-projects",
      ],
      [
        "vercel",
        "alias",
        "set",
        deploymentHost,
        "staging.asksiargao.com",
        "--scope",
        "ametel01s-projects",
      ],
    ]);
    expect(result).toEqual({
      deploymentUrl: `https://${deploymentHost}`,
      stagingUrl: "https://staging.asksiargao.com",
    });
    expect(messages.at(-1)).toBe("Staging deployed: https://staging.asksiargao.com");
  });

  test("denies dirty, non-main, and unpushed candidates before Vercel runs", async () => {
    const cases = [
      {
        outputs: [" M package.json\n"],
        message: "Staging deployment requires a clean worktree.",
      },
      {
        outputs: ["", "codex/example\n"],
        message: "Staging deployment requires the main branch.",
      },
      {
        outputs: ["", "main\n", "", `${sha}\n`, `${"b".repeat(40)}\n`],
        message: "Staging deployment requires HEAD to match upstream/main.",
      },
    ];

    for (const fixture of cases) {
      const commands: string[][] = [];
      await expect(
        runStagingDeployment({ run: commandRunner(commands, fixture.outputs) }),
      ).rejects.toThrow(fixture.message);
      expect(commands.some(([command]) => command === "vercel")).toBe(false);
    }
  });

  test("does not move the stable alias when Vercel reports the wrong target or state", async () => {
    for (const inspection of [
      { readyState: "ERROR", target: "staging", url: deploymentHost },
      { readyState: "READY", target: "production", url: deploymentHost },
      { readyState: "READY", target: "staging", url: "different.vercel.app" },
    ]) {
      const commands: string[][] = [];
      await expect(
        runStagingDeployment({
          log: () => undefined,
          run: commandRunner(commands, [
            "",
            "main\n",
            "",
            `${sha}\n`,
            `${sha}\n`,
            `https://${deploymentHost}\n`,
            JSON.stringify(inspection),
          ]),
        }),
      ).rejects.toThrow("Vercel did not return a READY staging deployment for the requested URL.");
      expect(commands.some((command) => command.includes("alias"))).toBe(false);
    }
  });
});

function commandRunner(commands: string[][], outputs: string[]): DeploymentCommandRunner {
  return async (command) => {
    commands.push([...command]);
    const stdout = outputs.shift();
    if (stdout === undefined) throw new Error(`Unexpected command: ${command.join(" ")}`);
    return { exitCode: 0, stdout };
  };
}
