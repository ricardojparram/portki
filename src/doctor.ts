import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanPorts } from "./procfs";
import type { PortEntry } from "./types";

const execFileAsync = promisify(execFile);

export type CommandResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export type DoctorSource = {
  name: "procfs" | "ss" | "lsof" | "fuser";
  available: boolean;
  primary?: boolean;
  listenerCount?: number;
  command?: string;
  note: string;
  error?: string;
};

export type DoctorReport = {
  primary: DoctorSource;
  sources: DoctorSource[];
  recommendations: string[];
};

type DoctorOptions = {
  scanner?: () => Promise<PortEntry[]>;
  runner?: CommandRunner;
};

export async function inspectDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const scanner = options.scanner ?? scanPorts;
  const runner = options.runner ?? runCommand;
  const sources: DoctorSource[] = [];
  const recommendations: string[] = [];

  let primary: DoctorSource;
  try {
    const entries = await scanner();
    primary = {
      name: "procfs",
      available: true,
      primary: true,
      listenerCount: entries.length,
      note: "Primary Linux source. Reads /proc/net and maps socket inodes to /proc/<pid>/fd."
    };
  } catch (error) {
    primary = {
      name: "procfs",
      available: false,
      primary: true,
      note: "Primary Linux source could not be read.",
      error: error instanceof Error ? error.message : String(error)
    };
    recommendations.push("Ensure /proc is mounted and readable. portki is Linux-first and needs procfs for normal operation.");
  }
  sources.push(primary);

  sources.push(await inspectSs(runner));
  sources.push(await inspectLsof(runner));
  sources.push(await inspectFuser(runner));

  if (sources.slice(1).every((source) => !source.available)) {
    recommendations.push("Install ss, lsof, or fuser only if you want cross-check diagnostics; portki does not require them.");
  }

  return { primary, sources, recommendations };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ["portki doctor", "", "primary source"];
  lines.push(formatSource(report.primary));
  lines.push("", "optional diagnostics");
  for (const source of report.sources.filter((candidate) => candidate.name !== "procfs")) {
    lines.push(formatSource(source));
  }
  if (report.recommendations.length > 0) {
    lines.push("", "recommendations");
    for (const recommendation of report.recommendations) lines.push(`- ${recommendation}`);
  }
  return lines.join("\n");
}

async function inspectSs(runner: CommandRunner): Promise<DoctorSource> {
  const available = await commandExists("ss", runner);
  if (!available) {
    return {
      name: "ss",
      available: false,
      command: "ss -H -lntu",
      note: "Optional socket cross-check not found."
    };
  }

  try {
    const result = await runner("ss", ["-H", "-lntu"]);
    return {
      name: "ss",
      available: true,
      command: "ss -H -lntu",
      listenerCount: countNonEmptyLines(result.stdout),
      note: "Optional kernel socket cross-check."
    };
  } catch (error) {
    return {
      name: "ss",
      available: true,
      command: "ss -H -lntu",
      note: "Available, but the diagnostic command failed.",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function inspectLsof(runner: CommandRunner): Promise<DoctorSource> {
  const available = await commandExists("lsof", runner);
  if (!available) {
    return {
      name: "lsof",
      available: false,
      command: "lsof -nP -iTCP -sTCP:LISTEN -iUDP",
      note: "Optional process/socket cross-check not found."
    };
  }

  try {
    const result = await runner("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP"]);
    return {
      name: "lsof",
      available: true,
      command: "lsof -nP -iTCP -sTCP:LISTEN -iUDP",
      listenerCount: Math.max(0, countNonEmptyLines(result.stdout) - 1),
      note: "Optional process/socket cross-check."
    };
  } catch (error) {
    return {
      name: "lsof",
      available: true,
      command: "lsof -nP -iTCP -sTCP:LISTEN -iUDP",
      note: "Available, but the diagnostic command failed.",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function inspectFuser(runner: CommandRunner): Promise<DoctorSource> {
  const available = await commandExists("fuser", runner);
  return {
    name: "fuser",
    available,
    command: "fuser -n tcp <port>",
    note: available
      ? "Available for targeted PID checks by port."
      : "Optional targeted PID diagnostic not found."
  };
}

async function commandExists(command: string, runner: CommandRunner): Promise<boolean> {
  try {
    const result = await runner("sh", ["-c", `command -v ${command}`]);
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, { timeout: 2500 });
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      code: 0
    };
  } catch (error) {
    const maybeError = error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: string };
    if (typeof maybeError.code === "number") {
      return {
        stdout: String(maybeError.stdout ?? ""),
        stderr: String(maybeError.stderr ?? ""),
        code: maybeError.code
      };
    }
    throw new Error(maybeError.message ?? "command failed", {
      cause: {
        stdout: maybeError.stdout,
        stderr: maybeError.stderr,
        code: maybeError.code
      }
    });
  }
}

function countNonEmptyLines(output: string): number {
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function formatSource(source: DoctorSource): string {
  const status = source.available ? "ok" : "missing";
  const count = source.listenerCount === undefined ? "" : ` listeners=${source.listenerCount}`;
  const command = source.command ? ` command="${source.command}"` : "";
  const error = source.error ? ` error="${source.error}"` : "";
  return `- ${source.name}: ${status}${count}${command} | ${source.note}${error}`;
}
