import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { fetchActiveConnections } from "../src/connections";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

describe("fetchActiveConnections", () => {
  const mockProcRoot = join(__dirname, "mock_proc");

  beforeAll(async () => {
    await mkdir(join(mockProcRoot, "net"), { recursive: true });

    const mockTcpContent = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 30001 1 0000000000000000
   1: 0100007F:0BB8 0200007F:C000 01 00000000:00000000 00:00000000 00000000  1000        0 30002 1 0000000000000000
   2: 0100007F:1A0A 0500007F:D000 06 00000000:00000000 00:00000000 00000000  1000        0 30003 1 0000000000000000
`;

    const mockTcp6Content = `  sl  local_address                         rem_address                         st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:0BB8 00000000000000000000000001000000:D000 01 00000000:00000000 00:00000000 00000000  1000        0 40001 1 0000000000000000
`;

    await writeFile(join(mockProcRoot, "net/tcp"), mockTcpContent);
    await writeFile(join(mockProcRoot, "net/tcp6"), mockTcp6Content);
  });

  afterAll(async () => {
    await rm(mockProcRoot, { recursive: true, force: true });
  });

  test("should parse active connections and filter out listening sockets", async () => {
    const connections = await fetchActiveConnections(3000, mockProcRoot);

    expect(connections).toHaveLength(2);

    const ipv4 = connections.find((c) => c.protocol === "tcp");
    expect(ipv4).toBeDefined();
    expect(ipv4?.localAddress).toBe("127.0.0.1");
    expect(ipv4?.localPort).toBe(3000);
    expect(ipv4?.remoteAddress).toBe("127.0.0.2");
    expect(ipv4?.remotePort).toBe(49152);
    expect(ipv4?.state).toBe("ESTABLISHED");

    const ipv6 = connections.find((c) => c.protocol === "tcp6");
    expect(ipv6).toBeDefined();
    expect(ipv6?.localAddress).toBe("::1");
    expect(ipv6?.localPort).toBe(3000);
    expect(ipv6?.remoteAddress).toBe("::1");
    expect(ipv6?.remotePort).toBe(53248);
    expect(ipv6?.state).toBe("ESTABLISHED");
  });

  test("should return empty array if no connections match the port", async () => {
    const connections = await fetchActiveConnections(9999, mockProcRoot);
    expect(connections).toHaveLength(0);
  });
});
