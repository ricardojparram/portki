import { describe, expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { PortUi } from "../src/tui";
import type { PortEntry } from "../src/types";

const entries: PortEntry[] = [
  {
    protocol: "tcp",
    address: "127.0.0.1",
    port: 3000,
    state: "LISTEN",
    inode: "3000",
    pid: 1111,
    cmdline: "node node_modules/.bin/next dev",
    cwd: "/srv/next-app",
    exe: "/usr/bin/node",
    app: "nextjs",
    detection: { app: "nextjs", confidence: 0.95, evidence: ["command next"] },
    risk: "low"
  },
  {
    protocol: "tcp",
    address: "0.0.0.0",
    port: 5432,
    state: "LISTEN",
    inode: "5432",
    pid: 2222,
    cmdline: "postgres -D /data",
    app: "postgres",
    detection: { app: "postgres", confidence: 0.98, evidence: ["command postgres"] },
    risk: "high"
  }
];

const podmanEntry: PortEntry = {
  protocol: "tcp",
  address: "127.0.0.1",
  port: 8080,
  state: "LISTEN",
  inode: "8080",
  pid: 3333,
  cmdline: "podman system service --time=0",
  cwd: "/run/user/1000/podman",
  exe: "/usr/bin/podman",
  app: "podman",
  detection: { app: "podman", confidence: 0.96, evidence: ["command podman"] },
  risk: "high"
};

const podmanRedisEntry: PortEntry = {
  ...podmanEntry,
  port: 6379,
  container: {
    engine: "podman",
    id: "abcdef123456",
    name: "redis-dev",
    image: "docker.io/library/redis:7-alpine",
    ports: [{ hostPort: 6379, containerPort: 6379, protocol: "tcp" }],
    evidence: ["podman ps", "published port 6379/tcp"]
  }
};

const CATPPUCCIN_BASE = [30, 30, 46, 255];
const CATPPUCCIN_MANTLE = [24, 24, 37, 255];
const CATPPUCCIN_TEXT = [205, 214, 244, 255];
const DEFAULT_BACKGROUND = [0, 0, 0, 255];
const DEFAULT_FOREGROUND = [255, 255, 255, 255];
const ANSI_BLACK = [0, 0, 0, 255];
const ANSI_DIM = [128, 128, 128, 255];

function colorBuffer(spanColor: { toInts?: () => [number, number, number, number]; buffer?: Uint16Array } | undefined): number[] | undefined {
  if (spanColor?.toInts) return spanColor.toInts();
  return spanColor?.buffer ? Array.from(spanColor.buffer) : undefined;
}

describe("PortUi", () => {
  test("renders table/inspector panes and opens vim command line", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 80, height: 24 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("PORTKI");
    expect(frame).toContain("nextjs");
    expect(frame).toContain("local port inspector");
    expect(frame).toContain("showing 2/2");
    expect(frame).toContain("1 of 2");
    expect(frame).toContain("╭");
    expect(frame).not.toContain("SEL");
    expect(frame).not.toContain("[ ]");
    expect(frame).not.toContain("[1]");
    expect(frame).not.toContain("[2]");
    expect(frame).not.toContain("[3]");

    act(() => setup.mockInput.pressKey(":"));
    await setup.flush();
    await setup.waitForFrame((frame: string) => frame.includes("Command"));

    act(() => setup.renderer.destroy());
  });

  test("filters visible rows from slash search by app and port", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("postgres"));

    await act(async () => {
      setup.mockInput.pressKey("/");
      await setup.mockInput.typeText("nextjs");
      setup.mockInput.pressEnter();
    });
    await setup.flush();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("nextjs");
    expect(frame).not.toContain("[PG]");

    await act(async () => {
      setup.mockInput.pressKey("/");
      await setup.mockInput.typeText("3000");
      setup.mockInput.pressEnter();
    });
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("3000");
    expect(frame).not.toContain("5432");

    act(() => setup.renderer.destroy());
  });

  test("search accepts printable keys from key names", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("postgres"));

    act(() => setup.mockInput.pressKey("/"));
    act(() => setup.mockInput.pressKey("n"));
    act(() => setup.mockInput.pressKey("e"));
    act(() => setup.mockInput.pressKey("x"));
    act(() => setup.mockInput.pressKey("t"));
    act(() => setup.mockInput.pressKey("j"));
    act(() => setup.mockInput.pressKey("s"));
    act(() => setup.mockInput.pressEnter());
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("[NEXT]");
    expect(frame).not.toContain("[PG]");

    act(() => setup.renderer.destroy());
  });

  test("shows kill confirmation as a centered modal", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    act(() => setup.mockInput.pressKey("d"));
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Kill listener?");
    expect(frame).toContain("SIGTERM");
    expect(frame).toContain("3000");
    expect(frame).toContain("Confirm: y/Enter | Cancel: n/Esc");
    expect(frame).not.toContain("y/Enter confirm");

    act(() => setup.renderer.destroy());
  });

  test("paints modals with a solid terminal background", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    act(() => setup.mockInput.pressKey("d"));
    await setup.flush();

    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const modalTitle = spans.find((span) => span.text.includes("Kill listener?"));
    expect(colorBuffer(modalTitle?.bg)).toEqual(DEFAULT_BACKGROUND);

    act(() => setup.renderer.destroy());
  });

  test("accepts Enter as a kill confirmation shortcut", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    act(() => setup.mockInput.pressKey("d"));
    await setup.flush();
    act(() => setup.mockInput.pressEnter());
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Kill listener?");

    act(() => setup.renderer.destroy());
  });

  test("renders app counts in a separate right-column summary card", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector");
    expect(frame).toContain("Summary");
    expect(frame).toContain("Apps in current list");
    expect(frame).toContain("nextjs");
    expect(frame).toContain("█");
    expect(frame).toContain("░");
    expect(frame).not.toContain("nextjs     #");

    act(() => setup.renderer.destroy());
  });

  test("renders app summary bars with app colors", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("postgres"));
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const barSpan = spans.find((span) => span.text.includes("█"));

    expect(colorBuffer(barSpan?.fg)).toBeDefined();
    expect(colorBuffer(barSpan?.fg)).not.toEqual(DEFAULT_FOREGROUND);

    act(() => setup.renderer.destroy());
  });

  test("selects rows with space and opens grouped kill confirmation", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    act(() => setup.mockInput.pressKey(" "));
    act(() => setup.mockInput.pressKey("j"));
    act(() => setup.mockInput.pressKey(" "));
    await setup.flush();

    let frame = setup.captureCharFrame();
    expect(frame).not.toContain("[x]");
    expect(frame).toContain("Selected 2");

    act(() => setup.mockInput.pressKey("d"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Kill listeners?");
    expect(frame).toContain("2 selected listeners");
    expect(frame).toContain("ports 3000, 5432");

    act(() => setup.renderer.destroy());
  });

  test("keeps selected and focused rows visible without Catppuccin RGB assumptions", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    act(() => setup.mockInput.pressKey(" "));
    act(() => setup.mockInput.pressKey("j"));
    act(() => setup.mockInput.pressKey(" "));
    await setup.flush();

    const frame = setup.captureSpans();
    const nextRow = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("[NEXT]"));
    const postgresRow = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("[PG]"));

    expect(nextRow ? nextRow.attributes & TextAttributes.BOLD : 0).toBe(TextAttributes.BOLD);
    expect(postgresRow ? postgresRow.attributes & TextAttributes.BOLD : 0).toBe(TextAttributes.BOLD);
    expect(colorBuffer(nextRow?.bg)).toBeDefined();
    expect(colorBuffer(postgresRow?.bg)).toBeDefined();
    expect(colorBuffer(nextRow?.fg)).toEqual(ANSI_BLACK);
    expect(colorBuffer(postgresRow?.fg)).toEqual(ANSI_BLACK);
    expect(colorBuffer(nextRow?.bg)).not.toEqual(colorBuffer(postgresRow?.bg));
    expect(colorBuffer(postgresRow?.bg)).not.toEqual(DEFAULT_FOREGROUND);
    expect(colorBuffer(postgresRow?.fg)).not.toEqual(DEFAULT_FOREGROUND);
    expect(colorBuffer(nextRow?.bg)).not.toEqual(CATPPUCCIN_BASE);
    expect(colorBuffer(postgresRow?.bg)).not.toEqual(CATPPUCCIN_BASE);

    act(() => setup.renderer.destroy());
  });

  test("renders listeners border without hardcoded Catppuccin text color", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const frame = setup.captureSpans();
    const listenersBorder = frame.lines
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes("Listeners"));

    expect(colorBuffer(listenersBorder?.fg)).not.toEqual(CATPPUCCIN_TEXT);

    act(() => setup.renderer.destroy());
  });

  test("does not paint the base UI with Catppuccin backgrounds", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const frame = setup.captureSpans();
    const backgrounds = frame.lines.flatMap((line) => line.spans).map((span) => colorBuffer(span.bg)).filter(Boolean);

    expect(backgrounds).not.toContainEqual(CATPPUCCIN_BASE);
    expect(backgrounds).not.toContainEqual(CATPPUCCIN_MANTLE);

    act(() => setup.renderer.destroy());
  });

  test("uses the full terminal viewport without outer padding", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 80, height: 24 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const firstLine = setup.captureCharFrame().split("\n")[0] ?? "";

    expect(firstLine.trimStart().startsWith("╭")).toBe(true);

    act(() => setup.renderer.destroy());
  });

  test("renders table headers with normal contrast instead of dim text", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const frame = setup.captureSpans();
    const riskHeader = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("RISK"));
    const visibleCount = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("visible listeners"));

    expect(riskHeader ? riskHeader.attributes & TextAttributes.BOLD : 0).toBe(TextAttributes.BOLD);
    expect(visibleCount ? visibleCount.attributes & TextAttributes.DIM : 0).toBe(0);

    act(() => setup.renderer.destroy());
  });

  test("renders lazygit-style footer labels", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Move: j/k | Select: <space> | Find: / | Command: : | Kill: d");

    act(() => setup.renderer.destroy());
  });

  test("renders inspector details as readable app and risk labels", async () => {
    const setup = await testRender(<PortUi initialEntries={[podmanEntry]} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("podman"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("App podman");
    expect(frame).toContain("Risk !! High");
    expect(frame).toContain("Port 8080");
    expect(frame).not.toContain("[POD] [!!] port 8080");

    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const cwd = spans.find((span) => span.text.includes("CWD"));
    const evidence = spans.find((span) => span.text.includes("Evidence"));
    expect(colorBuffer(cwd?.fg)).not.toEqual(ANSI_DIM);
    expect(colorBuffer(evidence?.fg)).not.toEqual(ANSI_DIM);

    act(() => setup.renderer.destroy());
  });

  test("renders container image metadata in the inspector", async () => {
    const setup = await testRender(<PortUi initialEntries={[podmanRedisEntry]} />, { width: 120, height: 32 });

    await setup.waitForFrame((frame: string) => frame.includes("redis-dev"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Container");
    expect(frame).toContain("Engine podman");
    expect(frame).toContain("Name redis-dev");
    expect(frame).toContain("Image redis:7-alpine");
    expect(frame).toContain("6379->6379/tcp");

    act(() => setup.renderer.destroy());
  });

  test("renders portki reserved port entry correctly", async () => {
    const portkiEntry: PortEntry = {
      protocol: "tcp",
      address: "127.0.0.1",
      port: 8888,
      state: "LISTEN",
      inode: "synthetic",
      pid: 1234,
      user: "user",
      app: "portki",
      name: "portki (reservado)",
      cmdline: "Puerto reservado/monopolizado por portki",
      risk: "low",
      detection: {
        app: "portki",
        confidence: 1,
        evidence: ["Monopolizado por portki"]
      }
    };

    const setup = await testRender(<PortUi initialEntries={[portkiEntry]} />, { width: 100, height: 28 });
    await setup.waitForFrame((frame: string) => frame.includes("portki"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("[PORTK]");
    expect(frame).toContain("portki (reservado)");
    act(() => setup.renderer.destroy());
  });

  test("navigates inspector tabs circularly using tab and arrow keys", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector [Detalles]");

    // Press 'l' to go to Connections
    act(() => setup.mockInput.pressKey("l"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector [Conexiones]");

    // Press 'l' to go to Logs
    act(() => setup.mockInput.pressKey("l"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector [Logs]");

    // Press 'l' again to wrap around to Detalles
    act(() => setup.mockInput.pressKey("l"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector [Detalles]");

    // Press 'h' to go backward to Logs
    act(() => setup.mockInput.pressKey("h"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector [Logs]");

    // Press 'h' again to go backward to Conexiones
    act(() => setup.mockInput.pressKey("h"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector [Conexiones]");

    act(() => setup.renderer.destroy());
  });

  test("switches ports while connections tab is active without crashing", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    
    // Press 'l' to go to Connections
    act(() => setup.mockInput.pressKey("l"));
    await setup.flush();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Inspector [Conexiones]");

    // Move down to select the next port (5432)
    act(() => setup.mockInput.pressKey("j"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("5432");

    // Move up to select the previous port (3000)
    act(() => setup.mockInput.pressKey("k"));
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("3000");

    act(() => setup.renderer.destroy());
  });
});

