import { describe, expect, test } from "bun:test";
import { executeKillPlan, planKill, planKillEntries } from "../src/kill-policy";
import type { PortEntry } from "../src/types";

function entry(overrides: Partial<PortEntry>): PortEntry {
  return {
    protocol: "tcp",
    address: "127.0.0.1",
    port: 3000,
    state: "LISTEN",
    inode: "1",
    pid: 1234,
    app: "node",
    detection: { app: "node", confidence: 0.8, evidence: [] },
    risk: "low",
    ...overrides
  };
}

describe("kill policy", () => {
  test("blocks protected or unresolved PIDs", () => {
    expect(planKill({ port: 3000 }).blocked).toBe(true);
    expect(planKill(entry({ pid: 1 })).blocked).toBe(true);
    expect(planKill(entry({ pid: process.pid })).blocked).toBe(true);
  });

  test("requires confirmation and warns for high risk apps", () => {
    const plan = planKill(entry({ app: "postgres", risk: "high" }));
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.warnings.join(" ")).toContain("high-risk");
  });

  test("sends SIGTERM first and completes when process exits", async () => {
    const signals: string[] = [];
    const result = await executeKillPlan(planKill(entry({ pid: 2345 })), {
      confirmed: true,
      kill(pid, signal) {
        signals.push(`${pid}:${signal}`);
      },
      isAlive() {
        return false;
      },
      delay: async () => {}
    });

    expect(result).toEqual({ status: "terminated", signal: "SIGTERM" });
    expect(signals).toEqual(["2345:SIGTERM"]);
  });

  test("requires force confirmation before SIGKILL", async () => {
    const result = await executeKillPlan(planKill(entry({ pid: 3456 })), {
      confirmed: true,
      kill() {},
      isAlive() {
        return true;
      },
      delay: async () => {}
    });

    expect(result.status).toBe("needs-force");
  });

  test("sends SIGKILL only after force confirmation", async () => {
    const signals: string[] = [];
    const result = await executeKillPlan(planKill(entry({ pid: 4567 })), {
      confirmed: true,
      forceConfirmed: true,
      kill(pid, signal) {
        signals.push(`${pid}:${signal}`);
      },
      isAlive(signal) {
        return signal === "after-term";
      },
      delay: async () => {}
    });

    expect(result).toEqual({ status: "killed", signal: "SIGKILL" });
    expect(signals).toEqual(["4567:SIGTERM", "4567:SIGKILL"]);
  });

  test("plans grouped kills with unique PIDs and high-risk warnings", () => {
    const plan = planKillEntries([
      entry({ pid: 1111, port: 3000 }),
      entry({ pid: 2222, port: 5432, app: "postgres", risk: "high" }),
      entry({ pid: 1111, port: 3001 })
    ]);

    expect(plan.blocked).toBe(false);
    expect(plan.pids).toEqual([1111, 2222]);
    expect(plan.warnings.join(" ")).toContain("high-risk");
  });
});
