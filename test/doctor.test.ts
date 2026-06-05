import { describe, expect, test } from "bun:test";
import { inspectDoctor, formatDoctorReport, type CommandRunner } from "../src/doctor";
import type { PortEntry } from "../src/types";

const entries: PortEntry[] = [
  {
    protocol: "tcp",
    address: "127.0.0.1",
    port: 3000,
    state: "LISTEN",
    inode: "3000",
    pid: 1111,
    app: "nextjs",
    detection: { app: "nextjs", confidence: 0.95, evidence: ["command next"] },
    risk: "low"
  },
  {
    protocol: "tcp",
    address: "0.0.0.0",
    port: 80,
    state: "LISTEN",
    inode: "80",
    pid: 2222,
    app: "nginx",
    detection: { app: "nginx", confidence: 0.98, evidence: ["command nginx"] },
    risk: "high"
  }
];

function fakeRunner(outputs: Record<string, string>): CommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const output = outputs[key];
    if (output === undefined) throw new Error(`missing command ${key}`);
    return { stdout: output, stderr: "", code: 0 };
  };
}

describe("doctor", () => {
  test("reports procfs as the primary source and counts optional tools", async () => {
    const report = await inspectDoctor({
      scanner: async () => entries,
      runner: fakeRunner({
        "sh -c command -v ss": "/usr/bin/ss\n",
        "ss -H -lntu": "tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nudp UNCONN 0 0 127.0.0.1:53 0.0.0.0:*\n",
        "sh -c command -v lsof": "/usr/bin/lsof\n",
        "lsof -nP -iTCP -sTCP:LISTEN -iUDP": "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnginx 2222 root 6u IPv4 1 0t0 TCP *:80 (LISTEN)\n",
        "sh -c command -v fuser": "/usr/bin/fuser\n"
      })
    });

    expect(report.primary.name).toBe("procfs");
    expect(report.primary.listenerCount).toBe(2);
    expect(report.sources.find((source) => source.name === "ss")?.listenerCount).toBe(2);
    expect(report.sources.find((source) => source.name === "lsof")?.listenerCount).toBe(1);
    expect(report.sources.find((source) => source.name === "fuser")?.available).toBe(true);
  });

  test("marks optional tools as absent without failing doctor", async () => {
    const report = await inspectDoctor({
      scanner: async () => entries,
      runner: fakeRunner({})
    });

    expect(report.primary.available).toBe(true);
    expect(report.sources.find((source) => source.name === "ss")?.available).toBe(false);
    expect(report.sources.find((source) => source.name === "lsof")?.available).toBe(false);
    expect(report.sources.find((source) => source.name === "fuser")?.available).toBe(false);
    expect(report.recommendations).toContain("Install ss, lsof, or fuser only if you want cross-check diagnostics; portki does not require them.");
  });

  test("formats a readable terminal report", async () => {
    const report = await inspectDoctor({
      scanner: async () => entries,
      runner: fakeRunner({})
    });
    const formatted = formatDoctorReport(report);

    expect(formatted).toContain("portki doctor");
    expect(formatted).toContain("primary source");
    expect(formatted).toContain("procfs");
    expect(formatted).toContain("optional diagnostics");
  });
});
