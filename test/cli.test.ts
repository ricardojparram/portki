import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";

const logs: string[] = [];
const errors: string[] = [];
const originalLog = console.log;
const originalError = console.error;

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  logs.length = 0;
  errors.length = 0;
});

function captureConsole() {
  console.log = (message?: unknown) => {
    logs.push(String(message ?? ""));
  };
  console.error = (message?: unknown) => {
    errors.push(String(message ?? ""));
  };
}

describe("CLI", () => {
  test("prints portki help", async () => {
    captureConsole();

    const code = await runCli(["--help"]);

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("portki");
    expect(logs.join("\n")).toContain("portki list [--json]");
    expect(logs.join("\n")).not.toContain("portui");
  });

  test("uses portki in kill usage errors", async () => {
    captureConsole();

    const code = await runCli(["kill"]);

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("Usage: portki kill <port|pid> --safe [--force]");
    expect(errors.join("\n")).not.toContain("portui");
  });
});
