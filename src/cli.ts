import { unlinkSync, accessSync, constants } from "fs";
import { basename } from "path";
import { scanPorts } from "./procfs";
import { executeKillPlan, planKill } from "./kill-policy";
import { formatDoctorReport, inspectDoctor } from "./doctor";
import type { PortEntry } from "./types";

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...args] = argv;

  if (!command) {
    const { runTui } = await import("./tui");
    await runTui();
    return 0;
  }

  if (command === "list") return listCommand(args);
  if (command === "kill") return killCommand(args);
  if (command === "doctor") return doctorCommand();
  if (command === "uninstall") return uninstallCommand();
  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return 2;
}

async function listCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const entries = await scanPorts();

  if (json) {
    console.log(JSON.stringify(entries, null, 2));
    return 0;
  }

  for (const entry of entries) {
    console.log(formatEntry(entry));
  }
  return 0;
}

async function doctorCommand(): Promise<number> {
  const report = await inspectDoctor();
  console.log(formatDoctorReport(report));
  return report.primary.available ? 0 : 1;
}

async function killCommand(args: string[]): Promise<number> {
  const target = args.find((arg) => !arg.startsWith("-"));
  const safe = args.includes("--safe");
  const force = args.includes("--force");

  if (!target) {
    console.error("Usage: portki kill <port|pid> --safe [--force]");
    return 2;
  }
  if (!safe) {
    console.error("Refusing non-TUI kill without --safe.");
    return 2;
  }

  const numericTarget = Number.parseInt(target, 10);
  if (!Number.isFinite(numericTarget)) {
    console.error(`Invalid target: ${target}`);
    return 2;
  }

  const entries = await scanPorts();
  const entry =
    entries.find((candidate) => candidate.port === numericTarget) ??
    entries.find((candidate) => candidate.pid === numericTarget) ??
    ({ pid: numericTarget } as PortEntry);

  const plan = planKill(entry);
  const result = await executeKillPlan(plan, {
    confirmed: true,
    forceConfirmed: force
  });

  console.log(JSON.stringify({ plan, result }, null, 2));
  return result.status === "terminated" || result.status === "killed" ? 0 : 1;
}

function formatEntry(entry: PortEntry): string {
  const pid = entry.pid ? String(entry.pid).padStart(6, " ") : "     -";
  const risk = entry.risk.toUpperCase().padEnd(6, " ");
  const app = entry.app.padEnd(8, " ");
  const container = entry.container ? ` container=${entry.container.engine}:${entry.container.name ?? entry.container.image ?? entry.container.id ?? "unknown"}` : "";
  return `${entry.protocol.padEnd(4, " ")} ${entry.address}:${entry.port} ${pid} ${app} ${risk} ${entry.cmdline ?? entry.exe ?? ""}${container}`;
}

async function uninstallCommand(): Promise<number> {
  const binaryPath = process.execPath;
  const binaryName = basename(binaryPath);

  if (binaryName !== "portki") {
    console.log("portki is running via Node/Bun (likely installed via npm or in development).");
    console.log("To uninstall the global npm package, please run:");
    console.log("  npm uninstall -g portki-tui");
    return 0;
  }

  try {
    accessSync(binaryPath, constants.W_OK);
  } catch (err) {
    console.error(`Error: Permission denied to remove portki at ${binaryPath}`);
    console.error("Please run the command with sudo:");
    console.error("  sudo portki uninstall");
    return 1;
  }

  try {
    unlinkSync(binaryPath);
    console.log(`Successfully uninstalled portki from ${binaryPath}`);
    return 0;
  } catch (err: any) {
    console.error(`Failed to uninstall portki: ${err.message}`);
    return 1;
  }
}

function printHelp() {
  console.log(`portki

Usage:
  portki
  portki list [--json]
  portki doctor
  portki kill <port|pid> --safe [--force]
  portki uninstall
`);
}
