import { describe, expect, test } from "bun:test";
import { access, stat, readFile } from "node:fs/promises";
import { join } from "node:path";

type PackageJson = {
  name: string;
  version: string;
  license?: string;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  repository?: { type?: string; url?: string };
  bugs?: { url?: string };
  homepage?: string;
  publishConfig?: { access?: string };
  engines?: Record<string, string>;
};

async function readPackageJson(): Promise<PackageJson> {
  return JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as PackageJson;
}

describe("npm package readiness", () => {
  test("publishes the portki command and release metadata", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.name).toBe("portki-tui");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.bin).toEqual({ portki: "bin/portki" });
    expect(packageJson.repository?.url).toContain("github.com/ricardojparram/portki");
    expect(packageJson.bugs?.url).toContain("github.com/ricardojparram/portki/issues");
    expect(packageJson.homepage).toContain("github.com/ricardojparram/portki");
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.engines?.node).toBeDefined();
    expect(packageJson.engines?.bun).toBeUndefined();
  });

  test("keeps the npm tarball intentionally small", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.files).toEqual(["assets", "bin", "dist", "README.md", "LICENSE"]);
  });

  test("pins dependency versions instead of publishing latest ranges", async () => {
    const packageJson = await readPackageJson();
    const versions = Object.values({
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {})
    });

    expect(versions.length).toBeGreaterThan(0);
    expect(versions).not.toContain("latest");
  });

  test("ships an executable POSIX wrapper", async () => {
    const wrapper = await stat(join(import.meta.dir, "..", "bin", "portki"));

    expect(wrapper.isFile()).toBe(true);
    expect(wrapper.mode & 0o111).not.toBe(0);
  });

  test("ships a curl-friendly install script", async () => {
    const installScriptPath = join(import.meta.dir, "..", "install.sh");
    const installScript = await readFile(installScriptPath, "utf8");

    await access(installScriptPath);
    expect(installScript).toContain("PORTKI_REPO=");
    expect(installScript).toContain("git clone");
    expect(installScript).toContain("bun install --frozen-lockfile");
    expect(installScript).toContain("bun run build");
    expect(installScript).toContain("npm pack");
    expect(installScript).toContain("npm install -g *.tgz");
    expect(installScript).toContain("command -v node");
    expect(installScript).toContain("command -v npm");
    expect(installScript).toContain("command -v git");
    expect(installScript).toContain("command -v bun");
    expect(installScript).toContain("command -v curl");
    expect(installScript).toContain("curl -fsSL https://bun.sh/install");
    expect(installScript).not.toContain("npm install -g portki ");
    expect(installScript).not.toContain("npm install -g portki\n");
    expect(installScript).not.toContain("sudo");
    expect(installScript).toContain("https://bun.sh");
  });
});
