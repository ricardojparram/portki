import { readdir, readFile, readlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseProcNet } from "./proc-net";
import { detectApp, riskForDetection } from "./detect";
import { enrichWithContainers } from "./containers";
import type { PortEntry, ProcessInfo, Protocol, SocketRecord } from "./types";

const PROC_NET_FILES: Array<[Protocol, string]> = [
  ["tcp", "net/tcp"],
  ["tcp6", "net/tcp6"],
  ["udp", "net/udp"],
  ["udp6", "net/udp6"]
];

export async function scanPorts(procRoot = "/proc"): Promise<PortEntry[]> {
  const [sockets, inodeMap] = await Promise.all([readSockets(procRoot), mapInodesToProcesses(procRoot)]);
  const entries: PortEntry[] = [];

  for (const socket of sockets) {
    const processes = inodeMap.get(socket.inode);
    if (!processes || processes.length === 0) {
      entries.push(await enrichEntry(socket, undefined));
      continue;
    }

    for (const processInfo of processes) {
      entries.push(await enrichEntry(socket, processInfo));
    }
  }

  const enriched = await enrichWithContainers(entries);
  return enriched.sort((left, right) => left.port - right.port || (left.pid ?? 0) - (right.pid ?? 0));
}

export async function readSockets(procRoot = "/proc"): Promise<SocketRecord[]> {
  const sockets: SocketRecord[] = [];
  for (const [protocol, relativePath] of PROC_NET_FILES) {
    const content = await readOptionalFile(join(procRoot, relativePath));
    if (content) sockets.push(...parseProcNet(content, protocol));
  }
  return sockets;
}

export async function mapInodesToProcesses(procRoot = "/proc"): Promise<Map<string, ProcessInfo[]>> {
  const map = new Map<string, ProcessInfo[]>();
  const processDirs = await readOptionalDir(procRoot);

  for (const dirent of processDirs) {
    if (!dirent.isDirectory() || !/^\d+$/.test(dirent.name)) continue;

    const pid = Number.parseInt(dirent.name, 10);
    const pidRoot = join(procRoot, dirent.name);
    const fdDir = join(pidRoot, "fd");
    const fds = await readOptionalDir(fdDir);
    if (fds.length === 0) continue;

    const processInfo = await readProcessInfo(pidRoot, pid);
    for (const fd of fds) {
      const link = await readOptionalLink(join(fdDir, fd.name));
      const inode = link?.match(/^socket:\[(\d+)\]$/)?.[1];
      if (!inode) continue;

      const existing = map.get(inode);
      if (existing) existing.push(processInfo);
      else map.set(inode, [processInfo]);
    }
  }

  for (const processes of map.values()) {
    processes.sort((left, right) => left.pid - right.pid);
  }

  return map;
}

async function enrichEntry(socket: SocketRecord, processInfo: ProcessInfo | undefined): Promise<PortEntry> {
  const base = {
    ...socket,
    ...(processInfo?.pid !== undefined ? { pid: processInfo.pid } : {}),
    ...(processInfo?.user !== undefined ? { user: processInfo.user } : {}),
    ...(processInfo?.uid !== undefined ? { uid: processInfo.uid } : {}),
    ...(processInfo?.cmdline !== undefined ? { cmdline: processInfo.cmdline } : {}),
    ...(processInfo?.cwd !== undefined ? { cwd: processInfo.cwd } : {}),
    ...(processInfo?.exe !== undefined ? { exe: processInfo.exe } : {}),
    ...(processInfo?.name !== undefined ? { name: processInfo.name } : {}),
    ...(processInfo?.permissionDenied !== undefined ? { permissionDenied: processInfo.permissionDenied } : {})
  };
  const detection = await detectApp(base);

  return {
    ...base,
    app: detection.app,
    detection,
    risk: riskForDetection(detection)
  };
}

async function readProcessInfo(pidRoot: string, pid: number): Promise<ProcessInfo> {
  const [cmdlineRaw, statusRaw, cwd, exe] = await Promise.all([
    readOptionalFile(join(pidRoot, "cmdline")),
    readOptionalFile(join(pidRoot, "status")),
    readOptionalLink(join(pidRoot, "cwd")),
    readOptionalLink(join(pidRoot, "exe"))
  ]);
  const status = parseStatus(statusRaw);

  const processInfo: ProcessInfo = { pid };

  if (status.uid !== undefined) processInfo.uid = status.uid;
  const cmdline = parseCmdline(cmdlineRaw);
  if (cmdline !== undefined) processInfo.cmdline = cmdline;
  if (cwd !== undefined) processInfo.cwd = cwd;
  if (exe !== undefined) processInfo.exe = exe;
  if (status.name !== undefined) processInfo.name = status.name;
  if (!cmdlineRaw && !cwd && !exe) processInfo.permissionDenied = true;
  return processInfo;
}

function parseCmdline(raw: string | undefined): string | undefined {
  const parts = raw?.split("\u0000").filter(Boolean);
  return parts && parts.length > 0 ? parts.join(" ") : undefined;
}

function parseStatus(raw: string | undefined): { name?: string; uid?: number } {
  const result: { name?: string; uid?: number } = {};
  if (!raw) return result;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("Name:")) result.name = line.slice("Name:".length).trim();
    if (line.startsWith("Uid:")) {
      const uid = line.slice("Uid:".length).trim().split(/\s+/)[0];
      if (uid) result.uid = Number.parseInt(uid, 10);
    }
  }

  return result;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readOptionalLink(path: string): Promise<string | undefined> {
  try {
    return await readlink(path);
  } catch {
    return undefined;
  }
}

async function readOptionalDir(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function displayCommand(entry: PortEntry): string {
  return entry.cmdline ?? entry.exe ? basename(entry.exe ?? "") : "unknown";
}
