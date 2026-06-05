import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const roots: string[] = [];

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "portki-bin-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bin/portki", () => {
  test("resolves dist relative to the package when invoked through a global symlink", async () => {
    const root = tempRoot();
    const packageRoot = join(root, "lib", "node_modules", "portki");
    const globalBin = join(root, "bin");
    await mkdir(join(packageRoot, "bin"), { recursive: true });
    await mkdir(join(packageRoot, "dist"), { recursive: true });
    await mkdir(globalBin, { recursive: true });
    const marker = join(root, "marker.txt");

    await writeFile(join(packageRoot, "bin", "portki"), await readFile(join(import.meta.dir, "..", "bin", "portki"), "utf8"));
    await chmod(join(packageRoot, "bin", "portki"), 0o755);
    await writeFile(
      join(packageRoot, "dist", "index.js"),
      "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.PORTKI_WRAPPER_MARKER, process.argv.slice(2).join(','));\n"
    );
    await symlink("../lib/node_modules/portki/bin/portki", join(globalBin, "portki"));

    const result = spawnSync(join(globalBin, "portki"), ["list", "--json"], {
      encoding: "utf8",
      env: { ...process.env, PORTKI_WRAPPER_MARKER: marker }
    });

    expect(result.status).toBe(0);
    expect(await readFile(marker, "utf8")).toBe("list,--json");
  });

  test("uses Node as the runtime instead of Bun", async () => {
    const wrapper = await readFile(join(import.meta.dir, "..", "bin", "portki"), "utf8");

    expect(wrapper).toContain("command -v node");
    expect(wrapper).toContain("exec node");
    expect(wrapper).not.toContain("command -v bun");
    expect(wrapper).not.toContain("exec bun");
    expect(wrapper).not.toContain("requires Bun");
  });
});
