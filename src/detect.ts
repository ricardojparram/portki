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
  [/(^|\s|\/)postgres(\s|$)/, "postgres", 0.98, "command postgres"],
  [/(^|\s|\/)redis-server(\s|$)/, "redis", 0.98, "command redis-server"],
  [/(^|\s|\/)(mysqld|mysql)(\s|$)/, "mysql", 0.95, "command mysql"],
  [/(^|\s|\/)(docker-proxy|dockerd|containerd|containerd-shim-runc-v2|docker)(\s|$)/, "docker", 0.98, "command docker"],
  [
    /(^|\s|\/)(podman|rootlessport(?:-child)?|slirp4netns|pasta|gvproxy|netavark|aardvark-dns)(\s|$)|\bconmon\b.*\b(libpod|podman)\b|\b(libpod|podman)\b.*\bconmon\b/,
    "podman",
    0.96,
    "command podman"
  ],
  [/@modelcontextprotocol\/server-[^\s]+|\bmcp-server[\w.-]*\b|\b[\w.-]*-mcp(?:@|\s|$)|(^|\s)mcp(\s|$)/, "mcp", 0.9, "command mcp"],
  [/(^|\s|\/)bun(\s|$)/, "bun", 0.75, "command bun"],
  [/(^|\s|\/)deno(\s|$)/, "deno", 0.75, "command deno"],
  [/(^|\s|\/)node(\s|$)/, "node", 0.7, "command node"]
];

export async function detectApp(entry: Pick<PortEntry, "cmdline" | "cwd" | "exe">): Promise<AppDetection> {
  const candidates: Candidate[] = [];
  const command = [entry.exe, entry.cmdline].filter(Boolean).join(" ");

  for (const [pattern, app, confidence, evidence] of COMMAND_PATTERNS) {
    if (pattern.test(command)) candidates.push({ app, confidence, evidence });
  }

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
  if (["postgres", "redis", "mysql", "docker", "podman"].includes(detection.app)) return "high";
  if (detection.app === "mcp") return "medium";
  if (["program", "unknown"].includes(detection.app)) return "medium";
  return "low";
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
