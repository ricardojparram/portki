import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("build config", () => {
  test("builds a Node-compatible bundle and keeps native OpenTUI packages external", async () => {
    const packageJson = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
      scripts: { build: string };
    };

    expect(packageJson.scripts.build).toContain("--target node");
    expect(packageJson.scripts.build).not.toContain("--target bun");
    expect(packageJson.scripts.build).not.toContain("--external react");
    expect(packageJson.scripts.build).not.toContain("--external @opentui/react");
    expect(packageJson.scripts.build).toContain("--external @opentui/core-linux-x64");
    expect(packageJson.scripts.build).toContain("--external @opentui/core-linux-x64-musl");
  });
});
