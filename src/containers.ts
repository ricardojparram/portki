import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ContainerInfo, ContainerPort, PortEntry } from "./types";

const execFileAsync = promisify(execFile);

export type ContainerRunner = (command: string, args: string[]) => Promise<string>;

type ContainerOptions = {
  runner?: ContainerRunner;
};

export async function enrichWithContainers(entries: PortEntry[], options: ContainerOptions = {}): Promise<PortEntry[]> {
  const runner = options.runner ?? runContainerCommand;
  const containers = await listContainers(runner);
  if (containers.length === 0) return entries;

  return entries.map((entry) => {
    const container = matchContainer(entry, containers);
    return container ? { ...entry, container } : entry;
  });
}

export function parsePodmanPsJson(raw: string): ContainerInfo[] {
  const parsed = parseJsonArray(raw);
  return parsed.map((item) => {
    const ports = parsePodmanPorts(item.Ports);
    const container: ContainerInfo = {
      engine: "podman",
      ports,
      evidence: ["podman ps"]
    };
    const id = stringField(item.Id ?? item.ID);
    const name = nameField(item.Names ?? item.Name);
    const image = stringField(item.Image);
    if (id !== undefined) container.id = id;
    if (name !== undefined) container.name = name;
    if (image !== undefined) container.image = image;
    return container;
  }).filter((container) => container.ports.length > 0);
}

export function parseDockerPsJsonLines(raw: string): ContainerInfo[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const container: ContainerInfo = {
        engine: "docker",
        ports: parseDockerPorts(stringField(item.Ports) ?? ""),
        evidence: ["docker ps"]
      };
      const id = stringField(item.ID ?? item.Id);
      const name = nameField(item.Names ?? item.Name);
      const image = stringField(item.Image);
      if (id !== undefined) container.id = id;
      if (name !== undefined) container.name = name;
      if (image !== undefined) container.image = image;
      return container;
    })
    .filter((container) => container.ports.length > 0);
}

async function listContainers(runner: ContainerRunner): Promise<ContainerInfo[]> {
  const [podman, docker] = await Promise.all([
    tryCommand(runner, "podman", ["ps", "--format", "json"]).then((output) => parsePodmanPsJson(output ?? "")),
    tryCommand(runner, "docker", ["ps", "--format", "{{json .}}"]).then((output) => parseDockerPsJsonLines(output ?? ""))
  ]);
  return [...podman, ...docker];
}

function matchContainer(entry: PortEntry, containers: ContainerInfo[]): ContainerInfo | undefined {
  const protocol = entry.protocol.startsWith("udp") ? "udp" : "tcp";
  for (const container of containers) {
    const port = container.ports.find((candidate) => candidate.hostPort === entry.port && (!candidate.protocol || candidate.protocol === protocol));
    if (!port) continue;

    return {
      ...container,
      evidence: [...container.evidence, `published port ${port.hostPort}/${port.protocol ?? protocol}`]
    };
  }
  return undefined;
}

function parsePodmanPorts(raw: unknown): ContainerPort[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((port) => {
      if (!port || typeof port !== "object") return [];
      const item = port as Record<string, unknown>;
      const hostPort = numberField(item.host_port ?? item.HostPort ?? item.hostPort);
      if (hostPort === undefined) return [];
      const containerPort = numberField(item.container_port ?? item.ContainerPort ?? item.containerPort);
      const hostIp = stringField(item.host_ip ?? item.HostIP ?? item.hostIp);
      const protocol = protocolField(item.protocol ?? item.Protocol);
      const parsed: ContainerPort = { hostPort };
      if (containerPort !== undefined) parsed.containerPort = containerPort;
      if (hostIp !== undefined) parsed.hostIp = hostIp;
      if (protocol !== undefined) parsed.protocol = protocol;
      return [parsed];
    });
  }

  if (typeof raw === "string") return parseDockerPorts(raw);
  return [];
}

function parseDockerPorts(raw: string): ContainerPort[] {
  const ports: ContainerPort[] = [];
  const pattern = /(?:(?<hostIp>\d{1,3}(?:\.\d{1,3}){3}|\[::\]|::):)?(?<hostPort>\d+)->(?<containerPort>\d+)\/(?<protocol>tcp|udp)/g;
  for (const match of raw.matchAll(pattern)) {
    const hostPort = numberField(match.groups?.hostPort);
    if (hostPort === undefined) continue;
    const containerPort = numberField(match.groups?.containerPort);
    const protocol = protocolField(match.groups?.protocol);
    const parsed: ContainerPort = { hostPort };
    if (containerPort !== undefined) parsed.containerPort = containerPort;
    if (match.groups?.hostIp !== undefined) parsed.hostIp = match.groups.hostIp;
    if (protocol !== undefined) parsed.protocol = protocol;
    ports.push(parsed);
  }
  return ports;
}

async function runContainerCommand(command: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync(command, args, { timeout: 1200 });
    return String(result.stdout ?? "");
  } catch {
    return "";
  }
}

async function tryCommand(runner: ContainerRunner, command: string, args: string[]): Promise<string | undefined> {
  try {
    return await runner(command, args);
  } catch {
    return undefined;
  }
}

function parseJsonArray(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  } catch {
    return [];
  }
}

function stringField(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function nameField(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(stringField).find(Boolean);
  return stringField(value);
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function protocolField(value: unknown): "tcp" | "udp" | undefined {
  return value === "tcp" || value === "udp" ? value : undefined;
}
