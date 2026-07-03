import { describe, expect, test } from "bun:test";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";

describe("Postgres connection options", () => {
  test("uses local-compatible app defaults outside production", () => {
    const options = createPostgresConnectionOptions("app", { NODE_ENV: "development" });

    expect(options).toEqual({
      connect_timeout: 10,
      connection: {
        statement_timeout: 0,
      },
      idle_timeout: 30,
      max: 10,
      max_lifetime: 1_800,
      prepare: false,
      ssl: false,
    });
  });

  test("uses production app defaults when NODE_ENV is production", () => {
    const options = createPostgresConnectionOptions("app", { NODE_ENV: "production" });

    expect(options).toMatchObject({
      connection: {
        statement_timeout: 30_000,
      },
      max: 10,
      prepare: false,
      ssl: "require",
    });
  });

  test("uses a small production CLI pool and longer statement timeout by default", () => {
    const options = createPostgresConnectionOptions("cli", { NODE_ENV: "production" });

    expect(options).toMatchObject({
      connection: {
        statement_timeout: 120_000,
      },
      max: 1,
      prepare: false,
      ssl: "require",
    });
  });

  test("uses separate app and CLI pool-size environment variables", () => {
    const env = {
      DATABASE_CLI_POOL_SIZE: "2",
      DATABASE_POOL_SIZE: "12",
      NODE_ENV: "production",
    } as const;

    expect(createPostgresConnectionOptions("app", env).max).toBe(12);
    expect(createPostgresConnectionOptions("cli", env).max).toBe(2);
  });

  test("parses shared timeout and lifetime overrides", () => {
    const options = createPostgresConnectionOptions("app", {
      DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      DATABASE_IDLE_TIMEOUT_SECONDS: "0",
      DATABASE_MAX_LIFETIME_SECONDS: "900",
      DATABASE_STATEMENT_TIMEOUT_MS: "45000",
      NODE_ENV: "production",
    });

    expect(options).toMatchObject({
      connect_timeout: 5,
      connection: {
        statement_timeout: 45_000,
      },
      idle_timeout: 0,
      max_lifetime: 900,
    });
  });

  test.each([
    ["disable", false],
    ["allow", "allow"],
    ["prefer", "prefer"],
    ["require", "require"],
    ["verify-full", "verify-full"],
  ] as const)("parses DATABASE_SSL_MODE=%s", (sslMode, expected) => {
    const options = createPostgresConnectionOptions("app", {
      DATABASE_SSL_MODE: sslMode,
      NODE_ENV: "production",
    });

    expect(options.ssl).toBe(expected);
  });

  test.each([
    ["DATABASE_POOL_SIZE", "0", "app"],
    ["DATABASE_CLI_POOL_SIZE", "0", "cli"],
    ["DATABASE_CONNECT_TIMEOUT_SECONDS", "0", "app"],
    ["DATABASE_IDLE_TIMEOUT_SECONDS", "-1", "app"],
    ["DATABASE_MAX_LIFETIME_SECONDS", "1.5", "app"],
    ["DATABASE_STATEMENT_TIMEOUT_MS", "-1", "app"],
  ] as const)("rejects invalid %s=%s", (name, value, profile) => {
    expect(() =>
      createPostgresConnectionOptions(profile, {
        [name]: value,
      }),
    ).toThrow(`${name} must be an integer`);
  });

  test("rejects unknown SSL modes", () => {
    expect(() =>
      createPostgresConnectionOptions("app", {
        DATABASE_SSL_MODE: "on",
      }),
    ).toThrow("DATABASE_SSL_MODE must be one of");
  });
});
