import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("build config", () => {
  test("keeps React external so OpenTUI and the app share one React dispatcher", async () => {
    const packageJson = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
      scripts: { build: string };
    };

    expect(packageJson.scripts.build).toContain("--external react");
    expect(packageJson.scripts.build).toContain("--external react/jsx-runtime");
    expect(packageJson.scripts.build).toContain("--external react/jsx-dev-runtime");
  });
});
