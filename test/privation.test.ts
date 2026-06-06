import { describe, expect, test } from "bun:test";
import { PortPrivationManager } from "../src/privation";
import { createServer } from "node:net";

describe("PortPrivationManager", () => {
  test("should reserve and release a port successfully", async () => {
    const manager = new PortPrivationManager();
    const testPort = 12345; // Test port unlikely to be occupied

    // 1. Reserve port
    const reserved = await manager.privarPort(testPort);
    expect(reserved).toBe(true);
    expect(manager.isPrivated(testPort)).toBe(true);

    // 2. Try to bind another server to the same port (should fail)
    const secondServer = createServer();
    const bindFailed = await new Promise<boolean>((resolve) => {
      secondServer.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      secondServer.listen(testPort, "127.0.0.1", () => {
        secondServer.close();
        resolve(false); // Should not succeed
      });
    });
    expect(bindFailed).toBe(true);

    // 3. Release port
    const released = await manager.liberarPort(testPort);
    expect(released).toBe(true);
    expect(manager.isPrivated(testPort)).toBe(false);

    // 4. Try to bind another server again (should now succeed)
    const bindSuccess = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.on("error", () => {
        resolve(false);
      });
      server.listen(testPort, "127.0.0.1", () => {
        server.close(() => {
          resolve(true);
        });
      });
    });
    expect(bindSuccess).toBe(true);
  });
});
