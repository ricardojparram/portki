import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AppDetection, AppKind, PortEntry, RiskLevel } from "./types";

type Candidate = {
  app: AppKind;
  confidence: number;
  evidence: string;
};

const COMMAND_PATTERNS: Array<[RegExp, AppKind, number, string]> = [
  [/(^|\s|\/)next(\s|$)|node_modules\/\.bin\/next\b/, "nextjs", 0.95, "command next"],
  [/(^|\s|\/)nest(\s|$)|@nestjs\/cli/, "nestjs", 0.92, "command nest"],
  [/(^|\s|\/)vite(\s|$)|node_modules\/\.bin\/vite\b/, "vite", 0.92, "command vite"],
  [/(^|\s|\/)(apache2|httpd|apachectl)(\s|$)|\bapache\b/, "apache", 0.98, "command apache"],
  [/(^|\s|\/)nginx(\s|:|$)/, "nginx", 0.98, "command nginx"],
  [/(^|\s|\/)caddy(\s|$)/, "caddy", 0.96, "command caddy"],
  [/(^|\s|\/)lighttpd(\s|$)/, "lighttpd", 0.96, "command lighttpd"],
  [/(^|\s|\/)traefik(\s|$)/, "traefik", 0.96, "command traefik"],
  [/(^|\s|\/)haproxy(\s|$)/, "haproxy", 0.96, "command haproxy"],
  [/(^|\s|\/)envoy(\s|$)/, "envoy", 0.96, "command envoy"],
  [/(^|\s|\/)postgres(\s|$)/, "postgres", 0.98, "command postgres"],
  [/(^|\s|\/)redis-server(\s|$)/, "redis", 0.98, "command redis-server"],
  [/(^|\s|\/)(mysqld|mysql)(\s|$)/, "mysql", 0.95, "command mysql"],
  [/(^|\s|\/)(mongod|mongodb)(\s|$)/, "mongodb", 0.95, "command mongodb"],
  [/(^|\s|\/)elasticsearch(\s|$)/, "elasticsearch", 0.95, "command elasticsearch"],
  [/(^|\s|\/)(rabbitmq-server|beam\.smp)(\s|$)/, "rabbitmq", 0.92, "command rabbitmq"],
  [/(^|\s|\/)memcached(\s|$)/, "memcached", 0.95, "command memcached"],
  [/(^|\s|\/)(docker-proxy|dockerd|containerd|containerd-shim-runc-v2|docker)(\s|$)/, "docker", 0.98, "command docker"],
  [
    /(^|\s|\/)(podman|rootlessport(?:-child)?|slirp4netns|pasta|gvproxy|netavark|aardvark-dns)(\s|$)|\bconmon\b.*\b(libpod|podman)\b|\b(libpod|podman)\b.*\bconmon\b/,
    "podman",
    0.96,
    "command podman"
  ],
  [/@modelcontextprotocol\/server-[^\s]+|\bmcp-server[\w.-]*\b|\b[\w.-]*-mcp(?:@|\s|$)|(^|\s)mcp(\s|$)/, "mcp", 0.9, "command mcp"],
  [/gsconnect@andyholmes\.github\.io|(^|\s|\/)gsconnect(\s|$)/, "gsconnect", 0.94, "command gsconnect"],
  [/(^|\s|\/)wsdd(\s|$)|\/usr\/bin\/wsdd\b/, "wsdd", 0.94, "command wsdd"],
  [/(^|\s|\/)engram(\s|$)/, "engram", 0.94, "command engram"],
  [/--od-stamp-app=|\/open-design\/|(^|\s)open-design(\s|$)/, "opendesign", 0.9, "command open-design"],
  [/(^|\s|\/)(php-fpm|php)(\s|$)/, "php", 0.82, "command php"],
  [/(^|\s|\/)(python[0-9.]?|gunicorn|uvicorn)(\s|$)/, "python", 0.78, "command python"],
  [/(^|\s|\/)(java|jsvc)(\s|$)|\b(org\.apache\.catalina|tomcat|jetty|springframework)\b/, "java", 0.75, "command java"],
  [/(^|\s|\/)(ruby|rails|puma|thin|unicorn)(\s|$)/, "ruby", 0.75, "command ruby"],
  [/(^|\s|\/)sshd(\s|$)/, "ssh", 0.95, "command sshd"],
  [/(^|\s|\/)(named|dnsmasq|systemd-resolved|unbound|coredns)(\s|$)/, "dns", 0.92, "command dns"],
  [/(^|\s|\/)bun(\s|$)/, "bun", 0.75, "command bun"],
  [/(^|\s|\/)deno(\s|$)/, "deno", 0.75, "command deno"],
  [/(^|\s|\/)node(\s|$)/, "node", 0.7, "command node"]
];

export async function detectApp(entry: Pick<PortEntry, "cmdline" | "cwd" | "exe" | "name" | "port" | "protocol" | "uid">): Promise<AppDetection> {
  const candidates: Candidate[] = [];
  const command = [entry.exe, entry.name, entry.cmdline].filter(Boolean).join(" ");

  for (const [pattern, app, confidence, evidence] of COMMAND_PATTERNS) {
    if (pattern.test(command)) candidates.push({ app, confidence, evidence });
  }

  candidates.push(...detectFromPort(entry.port, entry.protocol));
  candidates.push(...detectFromUid(entry.uid));

  if (entry.cwd) {
    candidates.push(...(await detectFromCwd(entry.cwd)));
  }

  const best = candidates.sort((left, right) => right.confidence - left.confidence)[0];
  if (best) {
    return {
      app: best.app,
      confidence: best.confidence,
      evidence: candidates.filter((candidate) => candidate.app === best.app).map((candidate) => candidate.evidence)
    };
  }

  if (entry.exe) {
    return {
      app: "program",
      confidence: 0.45,
      evidence: [`binary ${basename(entry.exe)}`]
    };
  }

  return { app: "unknown", confidence: 0, evidence: [] };
}

export function riskForDetection(detection: AppDetection): RiskLevel {
  if (
    [
      "postgres",
      "redis",
      "mysql",
      "mongodb",
      "elasticsearch",
      "rabbitmq",
      "memcached",
      "docker",
      "podman",
      "apache",
      "nginx",
      "caddy",
      "lighttpd",
      "traefik",
      "haproxy",
      "envoy",
      "ssh",
      "dns",
      "dhcp",
      "chrony",
      "cups",
      "mdns",
      "llmnr",
      "passim",
      "system"
    ].includes(detection.app)
  ) {
    return "high";
  }
  if (["mcp", "gsconnect", "wsdd"].includes(detection.app)) return "medium";
  if (["program", "unknown"].includes(detection.app)) return "medium";
  return "low";
}

function detectFromPort(port: number, protocol: PortEntry["protocol"]): Candidate[] {
  const candidates: Candidate[] = [];
  const transport = protocol.startsWith("udp") ? "udp" : "tcp";
  const hint = (app: AppKind, confidence: number, evidence: string) => candidates.push({ app, confidence, evidence });

  if (transport === "tcp") {
    if (port === 22) hint("ssh", 0.38, "port 22 ssh");
    if (port === 631) hint("cups", 0.38, "port 631 cups");
    if (port === 80) hint("web", 0.38, "port 80 http");
    if (port === 443) hint("web", 0.38, "port 443 https");
    if ([8000, 8080, 8443, 8888].includes(port)) hint("web", 0.32, `port ${port} web`);
    if (port === 5432) hint("postgres", 0.35, "port 5432 postgres");
    if (port === 6379) hint("redis", 0.35, "port 6379 redis");
    if (port === 3306) hint("mysql", 0.35, "port 3306 mysql");
    if (port === 27017) hint("mongodb", 0.35, "port 27017 mongodb");
    if (port === 9200) hint("elasticsearch", 0.35, "port 9200 elasticsearch");
    if (port === 5672) hint("rabbitmq", 0.35, "port 5672 rabbitmq");
    if (port === 11211) hint("memcached", 0.35, "port 11211 memcached");
    if (port === 27500) hint("passim", 0.38, "port 27500 passim");
  }

  if (port === 53) hint("dns", 0.38, "port 53 dns");
  if (port === 68 && transport === "udp") hint("dhcp", 0.38, "port 68 dhcp");
  if (port === 323 && transport === "udp") hint("chrony", 0.38, "port 323 chrony");
  if (port === 5353 && transport === "udp") hint("mdns", 0.38, "port 5353 mdns");
  if (port === 5355) hint("llmnr", 0.38, "port 5355 llmnr");
  return candidates;
}

function detectFromUid(uid: number | undefined): Candidate[] {
  if (uid === 0) return [{ app: "system", confidence: 0.24, evidence: "uid 0 system socket" }];
  return [];
}

async function detectFromCwd(cwd: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const has = (name: string) => existsSync(join(cwd, name));

  if (has("next.config.js") || has("next.config.mjs") || has("next.config.ts") || has(".next")) {
    candidates.push({ app: "nextjs", confidence: 0.86, evidence: "next project files" });
  }
  if (has("nest-cli.json")) {
    candidates.push({ app: "nestjs", confidence: 0.86, evidence: "nest-cli.json" });
  }

  const packageJson = await readPackageJson(cwd);
  if (!packageJson) return candidates;

  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  } as Record<string, unknown>;

  if ("next" in dependencies) {
    candidates.push({ app: "nextjs", confidence: 0.84, evidence: "package.json dependency next" });
  }
  if ("@nestjs/core" in dependencies) {
    candidates.push({ app: "nestjs", confidence: 0.84, evidence: "package.json dependency @nestjs/core" });
  }
  if ("vite" in dependencies) {
    candidates.push({ app: "vite", confidence: 0.8, evidence: "package.json dependency vite" });
  }

  return candidates;
}

async function readPackageJson(cwd: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
