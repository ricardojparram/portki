import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { mapInodesToProcesses } from "../src/procfs";

const roots: string[] = [];

function tempProc() {
  const root = mkdtempSync(join(tmpdir(), "portki-proc-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("mapInodesToProcesses", () => {
  test("maps socket symlinks to process metadata", async () => {
    const root = tempProc();
    const pidRoot = join(root, "1234");
    await mkdir(join(pidRoot, "fd"), { recursive: true });
    await symlink("socket:[4242]", join(pidRoot, "fd", "7"));
    await symlink("/usr/bin/node", join(pidRoot, "exe"));
    await symlink("/srv/app", join(pidRoot, "cwd"));
    await writeFile(join(pidRoot, "cmdline"), "node\u0000server.js\u0000");
    await writeFile(join(pidRoot, "status"), "Name:\tnode\nUid:\t1000\t1000\t1000\t1000\n");

    const map = await mapInodesToProcesses(root);

    expect(map.get("4242")).toEqual([
      {
        pid: 1234,
        uid: 1000,
        cmdline: "node server.js",
        cwd: "/srv/app",
        exe: "/usr/bin/node",
        name: "node"
      }
    ]);
  });

  test("supports multiple processes referencing one socket inode", async () => {
    const root = tempProc();
    for (const pid of ["111", "222"]) {
      await mkdir(join(root, pid, "fd"), { recursive: true });
      await symlink("socket:[777]", join(root, pid, "fd", "3"));
      await writeFile(join(root, pid, "cmdline"), `worker-${pid}\u0000`);
      await writeFile(join(root, pid, "status"), `Name:\tworker\nUid:\t${pid}\t${pid}\t${pid}\t${pid}\n`);
    }

    expect(mapInodesToProcesses(root).then((map) => map.get("777")?.map((p) => p.pid))).resolves.toEqual([111, 222]);
  });
});
