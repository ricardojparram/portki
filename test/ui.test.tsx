import { describe, expect, test } from "bun:test";
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
    expect(frame).toContain("y/Enter confirm");

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

  test("keeps focus styling visible when the focused row is selected", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    act(() => setup.mockInput.pressKey(" "));
    act(() => setup.mockInput.pressKey("j"));
    act(() => setup.mockInput.pressKey(" "));
    await setup.flush();

    const frame = setup.captureSpans();
    const nextRow = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("[NEXT]"));
    const postgresRow = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("[PG]"));

    expect(nextRow?.bg.buffer).toEqual(new Uint16Array([166, 227, 161, 255]));
    expect(postgresRow?.bg.buffer).toEqual(new Uint16Array([137, 180, 250, 255]));

    act(() => setup.renderer.destroy());
  });

  test("renders listeners border with the neutral card color", async () => {
    const setup = await testRender(<PortUi initialEntries={entries} />, { width: 100, height: 28 });

    await setup.waitForFrame((frame: string) => frame.includes("3000"));
    const frame = setup.captureSpans();
    const listenersBorder = frame.lines
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes("Listeners"));

    expect(listenersBorder?.fg.buffer).toEqual(new Uint16Array([205, 214, 244, 255]));

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

    act(() => setup.renderer.destroy());
  });
});
