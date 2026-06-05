import type { KillPlan, PortEntry } from "./types";

export type KillResult =
  | { status: "blocked"; reason: string }
  | { status: "needs-confirmation" }
  | { status: "needs-force"; remainingPids: number[] }
  | { status: "terminated"; signal: "SIGTERM" }
  | { status: "killed"; signal: "SIGKILL" }
  | { status: "permission-denied"; pid: number; signal: NodeJS.Signals };

export interface KillExecutor {
  confirmed?: boolean;
  forceConfirmed?: boolean;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  isAlive?: (phase: "after-term" | "after-kill", pid: number) => boolean;
  delay?: (ms: number) => Promise<void>;
  termWaitMs?: number;
}

export function planKill(entry: PortEntry | { pid?: number; port?: number; risk?: string; app?: string }): KillPlan {
  const pid = entry.pid;
  const warnings: string[] = [];

  if (!pid) {
    return blockedPlan("No PID is resolved for this socket.", entry.port);
  }
  if (pid === 1) {
    return blockedPlan("Refusing to kill PID 1.", entry.port, pid);
  }
  if (pid === process.pid) {
    return blockedPlan("Refusing to kill portki itself.", entry.port, pid);
  }

  if (entry.risk === "high") {
    warnings.push(`Target is high-risk (${entry.app ?? "unknown"}).`);
  }

  return {
    pids: [pid],
    ...(entry.port !== undefined ? { selectedPort: entry.port } : {}),
    signalFlow: ["SIGTERM", "SIGKILL"],
    warnings,
    requiresConfirmation: true,
    requiresForceConfirmation: true,
    blocked: false
  };
}

export function planKillEntries(entries: Array<PortEntry | { pid?: number; port?: number; risk?: string; app?: string }>): KillPlan {
  if (entries.length === 0) return blockedPlan("No listeners selected.");

  const pids: number[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const plan = planKill(entry);
    if (plan.blocked) return plan;
    for (const pid of plan.pids) {
      if (!pids.includes(pid)) pids.push(pid);
    }
    warnings.push(...plan.warnings);
  }

  if (pids.length === 0) return blockedPlan("No PID is resolved for the selected listeners.");

  return {
    pids,
    signalFlow: ["SIGTERM", "SIGKILL"],
    warnings: [...new Set(warnings)],
    requiresConfirmation: true,
    requiresForceConfirmation: true,
    blocked: false
  };
}

export async function executeKillPlan(plan: KillPlan, executor: KillExecutor = {}): Promise<KillResult> {
  if (plan.blocked) return { status: "blocked", reason: plan.reason ?? "Blocked by policy." };
  if (!executor.confirmed) return { status: "needs-confirmation" };

  const kill = executor.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  const delay = executor.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const isAlive = executor.isAlive ?? ((_phase: "after-term" | "after-kill", pid: number) => processIsAlive(pid));

  for (const pid of plan.pids) {
    const term = sendSignal(kill, pid, "SIGTERM");
    if (term) return term;
  }

  await delay(executor.termWaitMs ?? 1200);
  const remaining = plan.pids.filter((pid) => isAlive("after-term", pid));
  if (remaining.length === 0) return { status: "terminated", signal: "SIGTERM" };
  if (!executor.forceConfirmed) return { status: "needs-force", remainingPids: remaining };

  for (const pid of remaining) {
    const killed = sendSignal(kill, pid, "SIGKILL");
    if (killed) return killed;
  }

  await delay(100);
  return { status: "killed", signal: "SIGKILL" };
}

function blockedPlan(reason: string, port?: number, pid?: number): KillPlan {
  return {
    pids: pid ? [pid] : [],
    ...(port !== undefined ? { selectedPort: port } : {}),
    signalFlow: [],
    warnings: [reason],
    requiresConfirmation: false,
    requiresForceConfirmation: false,
    blocked: true,
    reason
  };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sendSignal(
  kill: (pid: number, signal: NodeJS.Signals) => void,
  pid: number,
  signal: NodeJS.Signals
): KillResult | undefined {
  try {
    kill(pid, signal);
    return undefined;
  } catch (error) {
    if (isPermissionError(error)) return { status: "permission-denied", pid, signal };
    return { status: "blocked", reason: error instanceof Error ? error.message : String(error) };
  }
}

function isPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
}
