export type Protocol = "tcp" | "tcp6" | "udp" | "udp6";

export type AppKind =
  | "nextjs"
  | "nestjs"
  | "vite"
  | "node"
  | "bun"
  | "deno"
  | "postgres"
  | "redis"
  | "mysql"
  | "mongodb"
  | "elasticsearch"
  | "rabbitmq"
  | "memcached"
  | "docker"
  | "podman"
  | "mcp"
  | "apache"
  | "nginx"
  | "caddy"
  | "lighttpd"
  | "traefik"
  | "haproxy"
  | "envoy"
  | "php"
  | "python"
  | "java"
  | "ruby"
  | "ssh"
  | "dns"
  | "web"
  | "program"
  | "unknown";

export type RiskLevel = "low" | "medium" | "high";

export interface AppDetection {
  app: AppKind;
  confidence: number;
  evidence: string[];
}

export interface ProcessInfo {
  pid: number;
  user?: string;
  uid?: number;
  cmdline?: string;
  cwd?: string;
  exe?: string;
  name?: string;
  permissionDenied?: boolean;
}

export interface SocketRecord {
  protocol: Protocol;
  address: string;
  port: number;
  state: string;
  inode: string;
  uid?: number;
}

export interface PortEntry extends SocketRecord {
  pid?: number;
  user?: string;
  cmdline?: string;
  cwd?: string;
  exe?: string;
  name?: string;
  app: AppKind;
  detection: AppDetection;
  risk: RiskLevel;
  permissionDenied?: boolean;
}

export interface KillPlan {
  pids: number[];
  selectedPort?: number;
  signalFlow: NodeJS.Signals[];
  warnings: string[];
  requiresConfirmation: boolean;
  requiresForceConfirmation: boolean;
  blocked: boolean;
  reason?: string;
}
