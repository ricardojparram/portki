import { createServer, type Server } from "node:net";

export class PortPrivationManager {
  private activeServers = new Map<number, Server>();

  public async privarPort(port: number): Promise<boolean> {
    if (this.activeServers.has(port)) {
      return true; // Already reserved
    }

    return new Promise((resolve) => {
      const server = createServer((socket) => {
        // Silently close incoming connections
        socket.end("Port reserved by portki-tui.\n");
      });

      server.on("error", () => {
        resolve(false);
      });

      server.listen(port, "127.0.0.1", () => {
        this.activeServers.set(port, server);
        resolve(true);
      });
    });
  }

  public async liberarPort(port: number): Promise<boolean> {
    const server = this.activeServers.get(port);
    if (!server) {
      return false;
    }

    return new Promise((resolve) => {
      server.close((err) => {
        this.activeServers.delete(port);
        resolve(!err);
      });
    });
  }

  public isPrivated(port: number): boolean {
    return this.activeServers.has(port);
  }

  public getPrivatedPorts(): number[] {
    return Array.from(this.activeServers.keys());
  }

  public async liberarTodos(): Promise<void> {
    const promises = this.getPrivatedPorts().map((port) => this.liberarPort(port));
    await Promise.all(promises);
  }
}

// Single instance for the application
export const privationManager = new PortPrivationManager();
