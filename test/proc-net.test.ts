import { describe, expect, test } from "bun:test";
import { parseProcNet } from "../src/proc-net";

describe("parseProcNet", () => {
  test("parses IPv4 TCP listeners and skips non-LISTEN sockets", () => {
    const input = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345 1",
      "   1: 00000000:1770 00000000:0000 01 00000000:00000000 00:00000000 00000000 1000 0 99999 1"
    ].join("\n");

    expect(parseProcNet(input, "tcp")).toEqual([
      {
        protocol: "tcp",
        address: "127.0.0.1",
        port: 3000,
        state: "LISTEN",
        inode: "12345",
        uid: 1000
      }
    ]);
  });

  test("parses IPv6 TCP listeners", () => {
    const input = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000000000000000000001000000:1388 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 45678 1"
    ].join("\n");

    expect(parseProcNet(input, "tcp6")[0]).toMatchObject({
      protocol: "tcp6",
      address: "::1",
      port: 5000,
      state: "LISTEN",
      inode: "45678"
    });
  });

  test("keeps UDP bound sockets regardless of state", () => {
    const input = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000:14E9 00000000:0000 07 00000000:00000000 00:00000000 00000000 1000 0 56789 1"
    ].join("\n");

    expect(parseProcNet(input, "udp")).toEqual([
      {
        protocol: "udp",
        address: "0.0.0.0",
        port: 5353,
        state: "UDP",
        inode: "56789",
        uid: 1000
      }
    ]);
  });
});
