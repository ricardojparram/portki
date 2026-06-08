import type { Protocol, SocketRecord } from "./types";

const TCP_STATES: Record<string, string> = {
  "0A": "LISTEN"
};

export function parseProcNet(content: string, protocol: Protocol): SocketRecord[] {
  const records: SocketRecord[] = [];
  const lines = content.split(/\r?\n/).slice(1);

  for (const line of lines) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 10) continue;

    const local = columns[1];
    const stateHex = columns[3];
    const uidText = columns[7];
    const inode = columns[9];
    if (!local || !stateHex || !inode) continue;

    const isTcp = protocol === "tcp" || protocol === "tcp6";
    if (isTcp && stateHex !== "0A") continue;

    const [addressHex, portHex] = local.split(":");
    if (!addressHex || !portHex) continue;

    const record: SocketRecord = {
      protocol,
      address: protocol.endsWith("6") ? decodeIpv6(addressHex) : decodeIpv4(addressHex),
      port: Number.parseInt(portHex, 16),
      state: isTcp ? (TCP_STATES[stateHex] ?? stateHex) : "UDP",
      inode
    };
    if (uidText) record.uid = Number.parseInt(uidText, 10);
    records.push(record);
  }

  return records;
}

export function decodeIpv4(hex: string): string {
  if (hex.length !== 8) return hex;
  const bytes = hex.match(/../g);
  if (!bytes) return hex;
  return bytes.reverse().map((byte) => Number.parseInt(byte, 16)).join(".");
}

export function decodeIpv6(hex: string): string {
  if (hex.length !== 32) return hex;

  const bytes = hex.match(/../g);
  if (!bytes) return hex;

  const ordered: number[] = [];
  for (let index = 0; index < bytes.length; index += 4) {
    const word = bytes.slice(index, index + 4).reverse();
    ordered.push(...word.map((byte) => Number.parseInt(byte, 16)));
  }

  const hextets: string[] = [];
  for (let index = 0; index < ordered.length; index += 2) {
    hextets.push(((ordered[index] ?? 0) * 256 + (ordered[index + 1] ?? 0)).toString(16));
  }

  return compressIpv6(hextets);
}

function compressIpv6(hextets: string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index <= hextets.length; index++) {
    if (hextets[index] === "0") {
      if (currentStart === -1) currentStart = index;
      currentLength += 1;
      continue;
    }

    if (currentLength > bestLength) {
      bestStart = currentStart;
      bestLength = currentLength;
    }
    currentStart = -1;
    currentLength = 0;
  }

  if (bestLength < 2) return hextets.join(":");

  const before = hextets.slice(0, bestStart).join(":");
  const after = hextets.slice(bestStart + bestLength).join(":");
  if (!before && !after) return "::";
  if (!before) return `::${after}`;
  if (!after) return `${before}::`;
  return `${before}::${after}`;
}
