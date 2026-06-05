import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { detectApp, riskForDetection } from "../src/detect";
import type { PortEntry } from "../src/types";

const roots: string[] = [];

function entry(overrides: Partial<PortEntry>): PortEntry {
  return {
    protocol: "tcp",
    address: "127.0.0.1",
    port: 3000,
    state: "LISTEN",
    inode: "1",
    app: "unknown",
    detection: { app: "unknown", confidence: 0, evidence: [] },
    risk: "low",
    ...overrides
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("detectApp", () => {
  test("detects Next.js from command line", async () => {
    const detection = await detectApp(entry({ cmdline: "node node_modules/.bin/next dev" }));
    expect(detection.app).toBe("nextjs");
    expect(detection.confidence).toBeGreaterThan(0.8);
  });

  test("detects NestJS from cwd package metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "portki-nest-"));
    roots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "@nestjs/core": "latest" } }));

    const detection = await detectApp(entry({ cmdline: "node dist/main.js", cwd: root }));
    expect(detection.app).toBe("nestjs");
    expect(detection.evidence).toContain("package.json dependency @nestjs/core");
  });

  test("marks infrastructure apps as high risk", async () => {
    expect(riskForDetection(await detectApp(entry({ cmdline: "postgres -D /var/lib/postgres" })))).toBe("high");
    expect(riskForDetection(await detectApp(entry({ exe: "/usr/bin/docker-proxy" })))).toBe("high");
    expect(riskForDetection(await detectApp(entry({ exe: "/usr/sbin/nginx", cmdline: "nginx: master process" })))).toBe("high");
  });

  test("detects common web servers and reverse proxies", async () => {
    expect((await detectApp(entry({ port: 80, exe: "/usr/sbin/apache2", cmdline: "/usr/sbin/apache2 -DFOREGROUND" }))).app).toBe("apache");
    expect((await detectApp(entry({ port: 443, exe: "/usr/sbin/httpd", cmdline: "httpd -DFOREGROUND" }))).app).toBe("apache");
    expect((await detectApp(entry({ exe: "/usr/sbin/nginx", cmdline: "nginx: master process /usr/sbin/nginx" }))).app).toBe("nginx");
    expect((await detectApp(entry({ exe: "/usr/bin/caddy", cmdline: "caddy run --config /etc/caddy/Caddyfile" }))).app).toBe("caddy");
    expect((await detectApp(entry({ exe: "/usr/bin/traefik", cmdline: "traefik --configFile=/etc/traefik.yml" }))).app).toBe("traefik");
    expect((await detectApp(entry({ exe: "/usr/sbin/haproxy", cmdline: "haproxy -f /etc/haproxy/haproxy.cfg" }))).app).toBe("haproxy");
  });

  test("uses well-known ports as low-confidence hints when process data is unavailable", async () => {
    const http = await detectApp(entry({ port: 80 }));
    const https = await detectApp(entry({ port: 443 }));
    const dns = await detectApp(entry({ port: 53 }));
    const dhcp = await detectApp(entry({ protocol: "udp", port: 68 }));
    const chrony = await detectApp(entry({ protocol: "udp", port: 323 }));
    const cups = await detectApp(entry({ port: 631 }));
    const mdns = await detectApp(entry({ protocol: "udp", port: 5353 }));
    const llmnr = await detectApp(entry({ port: 5355 }));
    const system = await detectApp(entry({ protocol: "udp", port: 40315, uid: 0 }));

    expect(http.app).toBe("web");
    expect(http.evidence).toContain("port 80 http");
    expect(http.confidence).toBeLessThan(0.5);
    expect(https.app).toBe("web");
    expect(dns.app).toBe("dns");
    expect(dhcp.app).toBe("dhcp");
    expect(chrony.app).toBe("chrony");
    expect(cups.app).toBe("cups");
    expect(mdns.app).toBe("mdns");
    expect(llmnr.app).toBe("llmnr");
    expect(system.app).toBe("system");
  });

  test("detects common desktop and developer helper listeners", async () => {
    expect((await detectApp(entry({ port: 1716, exe: "/usr/bin/gjs-console", name: "gjs", cmdline: "gjs -m /home/ricardo/.local/share/gnome-shell/extensions/gsconnect@andyholmes.github.io/service/daemon.js" }))).app).toBe("gsconnect");
    expect((await detectApp(entry({ port: 3702, exe: "/usr/bin/python3.13", name: "wsdd", cmdline: "/usr/bin/python3 /usr/bin/wsdd --no-host --discovery" }))).app).toBe("wsdd");
    expect((await detectApp(entry({ port: 7437, exe: "/home/linuxbrew/.linuxbrew/bin/engram", name: "engram", cmdline: "engram serve" }))).app).toBe("engram");
    expect((await detectApp(entry({ port: 33141, exe: "/home/ricardo/.nvm/versions/node/v24.15.0/bin/node", name: "MainThread", cmdline: "node apps/daemon/src/sidecar/index.ts --od-stamp-app=daemon --od-stamp-source=tools-dev" }))).app).toBe("opendesign");
  });

  test("detects Docker listener helpers beyond docker-proxy", async () => {
    expect((await detectApp(entry({ exe: "/usr/bin/dockerd", cmdline: "dockerd --host=fd://" }))).app).toBe("docker");
    expect((await detectApp(entry({ exe: "/usr/bin/containerd", cmdline: "containerd --config /etc/containerd/config.toml" }))).app).toBe("docker");
  });

  test("detects Podman listener helpers", async () => {
    expect((await detectApp(entry({ exe: "/usr/bin/podman", cmdline: "podman system service --time=0" }))).app).toBe("podman");
    expect((await detectApp(entry({ exe: "/usr/bin/conmon", cmdline: "conmon --api-version 1 -c libpod-123" }))).app).toBe("podman");
    expect((await detectApp(entry({ exe: "/usr/libexec/podman/rootlessport", cmdline: "rootlessport-child" }))).app).toBe("podman");
  });

  test("detects MCP servers", async () => {
    expect((await detectApp(entry({ cmdline: "bunx @modelcontextprotocol/server-filesystem /tmp" }))).app).toBe("mcp");
    expect((await detectApp(entry({ cmdline: "npx -y playwright-mcp@latest --port 8931" }))).app).toBe("mcp");
    expect((await detectApp(entry({ exe: "/usr/bin/node", cmdline: "node ./dist/mcp-server.js" }))).app).toBe("mcp");
  });

  test("falls back to program for real binaries", async () => {
    const detection = await detectApp(entry({ exe: "/usr/bin/python3.12", cmdline: "python3 -m http.server" }));
    expect(detection.app).toBe("python");
    expect(detection.evidence).toContain("command python");
  });
});
