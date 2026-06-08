import { readFile } from "node:fs/promises";
import { decodeIpv4, decodeIpv6 } from "./proc-net";
import type { ActiveConnection } from "./types";

const TCP_STATES: Record<string, string> = {
  "01": "ESTABLISHED",
  "02": "SYN_SENT",
  "03": "SYN_RECV",
  "04": "FIN_WAIT1",
  "05": "FIN_WAIT2",
  "06": "TIME_WAIT",
  "07": "CLOSE",
  "08": "CLOSE_WAIT",
  "09": "LAST_ACK",
  "0A": "LISTEN",
  "0B": "CLOSING"
};

export async function fetchActiveConnections(port: number, procRoot = "/proc"): Promise<ActiveConnection[]> {
  const tcpFiles: Array<{ path: string; protocol: "tcp" | "tcp6" }> = [
    { path: `${procRoot}/net/tcp`, protocol: "tcp" },
    { path: `${procRoot}/net/tcp6`, protocol: "tcp6" }
  ];

  const connections: ActiveConnection[] = [];

  for (const { path, protocol } of tcpFiles) {
    try {
      const content = await readFile(path, "utf-8");
      const lines = content.split(/\r?\n/).slice(1);

      for (const line of lines) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 10) continue;

        const local = columns[1];
        const remote = columns[2];
        const stateHex = columns[3];

        if (!local || !remote || !stateHex) continue;

        // Skip listening sockets
        if (stateHex === "0A") continue;

        const [localIpHex, localPortHex] = local.split(":");
        const [remoteIpHex, remotePortHex] = remote.split(":");

        if (!localIpHex || !localPortHex || !remoteIpHex || !remotePortHex) continue;

        const localPort = Number.parseInt(localPortHex, 16);
        if (localPort !== port) continue;

        const remotePort = Number.parseInt(remotePortHex, 16);
        const localAddress = protocol === "tcp6" ? decodeIpv6(localIpHex) : decodeIpv4(localIpHex);
        const remoteAddress = protocol === "tcp6" ? decodeIpv6(remoteIpHex) : decodeIpv4(remoteIpHex);
        const state = TCP_STATES[stateHex] ?? stateHex;

        connections.push({
          protocol,
          localAddress,
          localPort,
          remoteAddress,
          remotePort,
          state
        });
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error(`Error reading connections from ${path}:`, err);
      }
    }
  }

  return connections;
}
