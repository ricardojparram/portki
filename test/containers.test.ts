import { describe, expect, test } from "bun:test";
import { enrichWithContainers, parseDockerPsJsonLines, parsePodmanPsJson, type ContainerRunner } from "../src/containers";
import type { PortEntry } from "../src/types";

function entry(overrides: Partial<PortEntry>): PortEntry {
  return {
    protocol: "tcp",
    address: "0.0.0.0",
    port: 6379,
    state: "LISTEN",
    inode: "6379",
    pid: 1234,
    app: "podman",
    detection: { app: "podman", confidence: 0.96, evidence: ["command podman"] },
    risk: "high",
    ...overrides
  };
}

function fakeRunner(outputs: Record<string, string>): ContainerRunner {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const stdout = outputs[key];
    if (stdout === undefined) throw new Error(`missing command ${key}`);
    return stdout;
  };
}

describe("container metadata", () => {
  test("parses podman published ports with image and name", () => {
    const containers = parsePodmanPsJson(JSON.stringify([
      {
        Id: "abcdef123456",
        Names: ["redis-dev"],
        Image: "docker.io/library/redis:7-alpine",
        Ports: [{ host_ip: "0.0.0.0", host_port: 6379, container_port: 6379, protocol: "tcp" }]
      }
    ]));

    expect(containers[0]?.engine).toBe("podman");
    expect(containers[0]?.name).toBe("redis-dev");
    expect(containers[0]?.image).toBe("docker.io/library/redis:7-alpine");
    expect(containers[0]?.ports[0]?.hostPort).toBe(6379);
  });

  test("parses docker ps JSON lines port strings", () => {
    const containers = parseDockerPsJsonLines(
      '{"ID":"abc123","Image":"redis:7","Names":"redis-local","Ports":"0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp"}\n'
    );

    expect(containers[0]?.engine).toBe("docker");
    expect(containers[0]?.name).toBe("redis-local");
    expect(containers[0]?.ports[0]?.hostPort).toBe(6379);
  });

  test("enriches listener entries with matching container image data", async () => {
    const entries = [entry({ port: 6379, app: "podman" })];
    const enriched = await enrichWithContainers(entries, {
      runner: fakeRunner({
        "podman ps --format json": JSON.stringify([
          {
            Id: "abcdef123456",
            Names: ["redis-dev"],
            Image: "docker.io/library/redis:7-alpine",
            Ports: [{ host_ip: "0.0.0.0", host_port: 6379, container_port: 6379, protocol: "tcp" }]
          }
        ]),
        "docker ps --format {{json .}}": ""
      })
    });

    expect(enriched[0]?.container?.engine).toBe("podman");
    expect(enriched[0]?.container?.name).toBe("redis-dev");
    expect(enriched[0]?.container?.image).toBe("docker.io/library/redis:7-alpine");
    expect(enriched[0]?.container?.evidence).toContain("published port 6379/tcp");
  });
});
