import { useEffect, useMemo, useState, Fragment } from "react";
import { createCliRenderer, RGBA, TextAttributes, type KeyEvent } from "@opentui/core";
import { createRoot, useRenderer, useTerminalDimensions } from "@opentui/react";
import { executeKillPlan, planKillEntries } from "./kill-policy";
import { scanPorts } from "./procfs";
import type { AppKind, PortEntry, RiskLevel, ActiveConnection } from "./types";
import { fetchProcessLogs } from "./logs";
import { privationManager } from "./privation";
import { fetchActiveConnections } from "./connections";

type Mode = "normal" | "search" | "command" | "confirm" | "force-confirm" | "help";

interface TuiState {
  entries: PortEntry[];
  selected: number;
  filter: string;
  mode: Mode;
  command: string;
  status: string;
  selectedKeys: string[];
  pendingKillEntries: PortEntry[];
  quitRequested: boolean;
  inspectorTab: "details" | "connections" | "logs";
}

interface PortUiProps {
  renderer?: Awaited<ReturnType<typeof createCliRenderer>>;
  scanner?: () => Promise<PortEntry[]>;
  initialEntries?: PortEntry[];
}

const theme = {
  border: RGBA.defaultForeground(),
  borderHot: RGBA.fromIndex(14),
  dim: RGBA.fromIndex(7),
  green: RGBA.fromIndex(10),
  blue: RGBA.fromIndex(12),
  yellow: RGBA.fromIndex(11),
  red: RGBA.fromIndex(9),
  surface: RGBA.defaultBackground(),
  activeFg: RGBA.fromIndex(0),
  focusBg: RGBA.fromIndex(11),
  selectedBg: RGBA.fromIndex(10),
  selectedFocusBg: RGBA.fromIndex(14)
};

const cardBorderStyle = "rounded";

export async function runTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    consoleMode: "disabled"
  });
  const root = createRoot(renderer);
  root.render(<PortUi renderer={renderer} />);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function PortUi({ renderer: providedRenderer, scanner = scanPorts, initialEntries }: PortUiProps) {
  const contextRenderer = useRenderer();
  const terminal = useTerminalDimensions();
  const renderer = providedRenderer ?? contextRenderer;
  const [state, setState] = useState<TuiState>({
    entries: initialEntries ?? [],
    selected: 0,
    filter: "",
    mode: "normal",
    command: "",
    status: initialEntries ? `${initialEntries.length} sockets` : "Scanning /proc...",
    selectedKeys: [],
    pendingKillEntries: [],
    quitRequested: false,
    inspectorTab: "details"
  });

  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [spinnerFrame, setSpinnerFrame] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  const effectiveFilter = state.mode === "search" ? state.command : state.filter;
  const filtered = useMemo(() => filterEntries(state.entries, effectiveFilter), [state.entries, effectiveFilter]);
  const selectedIndex = Math.min(state.selected, Math.max(filtered.length - 1, 0));
  const selectedEntry = filtered[selectedIndex];
  const selectedPosition = filtered.length > 0 ? selectedIndex + 1 : 0;
  const headerHeight = 5;
  const rowCount = Math.max(6, terminal.height - 11);
  const summaryHeight = Math.max(7, Math.floor((terminal.height - 7) * 0.35));
  const rows = visibleRows(filtered, selectedIndex, rowCount);
  const appCounts = useMemo(() => summarizeApps(filtered), [filtered]);

  async function refresh(customStatus?: string) {
    setIsScanning(true);
    try {
      const rawEntries = await scanner();
      const privatedPorts = privationManager.getPrivatedPorts();
      
      const entries = rawEntries.map((entry) => {
        if (privatedPorts.includes(entry.port)) {
          return {
            ...entry,
            app: "portki" as AppKind,
            name: "portki (reservado)",
            cmdline: "Puerto reservado/monopolizado por portki",
            risk: "low" as const,
            detection: {
              app: "portki" as AppKind,
              confidence: 1,
              evidence: ["Monopolizado por portki"]
            }
          };
        }
        return entry;
      });

      for (const port of privatedPorts) {
        if (!entries.some((e) => e.port === port)) {
          entries.push({
            protocol: "tcp",
            address: "127.0.0.1",
            port,
            state: "LISTEN",
            inode: "synthetic",
            pid: process.pid,
            user: process.env.USER || "current_user",
            app: "portki",
            name: "portki (reservado)",
            cmdline: "Puerto reservado/monopolizado por portki",
            risk: "low",
            detection: {
              app: "portki",
              confidence: 1,
              evidence: ["Monopolizado por portki"]
            }
          });
        }
      }

      entries.sort((left, right) => left.port - right.port || (left.pid ?? 0) - (right.pid ?? 0));

      setState((current) => ({
        ...current,
        entries,
        selected: Math.min(current.selected, Math.max(entries.length - 1, 0)),
        selectedKeys: current.selectedKeys.filter((key) => entries.some((entry) => socketKey(entry) === key)),
        status: customStatus ?? `${entries.length} sockets`
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      setIsScanning(false);
    }
  }

  useEffect(() => {
    if (initialEntries) return;
    void refresh();
  }, [initialEntries]);

  useEffect(() => {
    if (state.quitRequested) {
      void privationManager.liberarTodos().then(() => {
        renderer.destroy();
      });
    }
  }, [renderer, state.quitRequested]);

  useEffect(() => {
    const onKey = (key: KeyEvent) => {
      setState((current) => handleKey(current, key, renderer, refresh));
    };
    renderer.keyInput.on("keypress", onKey);
    return () => {
      renderer.keyInput.off("keypress", onKey);
    };
  }, [renderer]);

  return (
    <box width="100%" height="100%" flexDirection="column">
      <Header
        total={state.entries.length}
        filtered={filtered.length}
        filter={effectiveFilter}
        status={state.status}
        isScanning={isScanning}
        spinnerChar={SPINNER_FRAMES[spinnerFrame]}
        headerHeight={headerHeight}
      />

      <box flexGrow={1} flexDirection="row" gap={1}>
        <box
          title={isScanning ? `Listeners ${SPINNER_FRAMES[spinnerFrame]}` : "Listeners"}
          bottomTitle={`${selectedPosition} of ${filtered.length}`}
          bottomTitleAlignment="right"
          border
          borderStyle={cardBorderStyle}
          borderColor={theme.border}
          flexGrow={1}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
        >
          <text height={1} attributes={TextAttributes.BOLD} content="RISK  APP      PORT   PID     COMMAND" />
          {rows.map(({ entry, index }) => (
            <ListenerRow
              key={`${entry.protocol}:${entry.inode}:${entry.pid ?? "none"}`}
              entry={entry}
              focused={index === selectedIndex}
              marked={state.selectedKeys.includes(socketKey(entry))}
            />
          ))}
          {filtered.length === 0 ? <text fg={theme.dim}>No listeners match this search</text> : null}
        </box>

        <box width="42%" flexDirection="column" gap={0}>
          <box
            title={
              state.inspectorTab === "details"
                ? "Inspector [Detalles]"
                : state.inspectorTab === "connections"
                ? "Inspector [Conexiones]"
                : "Inspector [Logs]"
            }
            border
            borderStyle={cardBorderStyle}
            borderColor={theme.border}
            flexGrow={1}
            flexDirection="column"
            paddingLeft={1}
            paddingRight={1}
          >
            <Inspector
              entry={selectedEntry}
              activeTab={state.inspectorTab}
              spinnerChar={SPINNER_FRAMES[spinnerFrame]}
            />
          </box>
          <box
            title="Summary"
            border
            borderStyle={cardBorderStyle}
            borderColor={theme.border}
            height={summaryHeight}
            flexDirection="column"
            paddingLeft={1}
            paddingRight={1}
          >
            <AppSummary entries={state.entries} appCounts={appCounts} total={filtered.length} />
          </box>
        </box>
      </box>

      <Footer state={state} />

      <Overlay state={state} filteredCount={filtered.length} />
    </box>
  );
}

function Header({
  total,
  filtered,
  filter,
  status,
  isScanning,
  spinnerChar,
  headerHeight
}: {
  total: number;
  filtered: number;
  filter: string;
  status: string;
  isScanning: boolean;
  spinnerChar: string;
  headerHeight: number;
}) {
  return (
    <box height={headerHeight} flexDirection="row">
      <box
        flexGrow={1}
        border
        borderStyle={cardBorderStyle}
        borderColor={theme.border}
        flexDirection="column"
        paddingLeft={1}
      >
        <text height={1} attributes={TextAttributes.BOLD} fg={theme.blue} content="PORTKI" />
        <text height={1} fg={theme.dim} content="local port inspector" />
        <text height={1} content={`${isScanning ? `${spinnerChar} ` : ""}showing ${filtered}/${total}  |  filter ${filter || "off"}  |  ${status}`} />
      </box>
    </box>
  );
}

function Footer({ state }: { state: TuiState }) {
  const selectedText = state.selectedKeys.length > 0 ? ` | Selected ${state.selectedKeys.length}` : "";
  const modeText = modeLine(state) === "normal" ? "" : `  ${modeLine(state)}`;
  return (
    <box height={1}>
      <text height={1} fg={theme.dim}>
        <span fg={theme.blue}>Move:</span> <span fg={theme.yellow}>j/k</span>
        <span fg={theme.dim}> | </span>
        <span fg={theme.blue}>Select:</span> <span fg={theme.yellow}>{"<space>"}</span>
        <span fg={theme.dim}> | </span>
        <span fg={theme.blue}>Find:</span> <span fg={theme.yellow}>/</span>
        <span fg={theme.dim}> | </span>
        <span fg={theme.blue}>Command:</span> <span fg={theme.yellow}>:</span>
        <span fg={theme.dim}> | </span>
        <span fg={theme.blue}>Kill:</span> <span fg={theme.yellow}>d</span>
        <span fg={theme.dim}> | </span>
        <span fg={theme.blue}>R:</span> <span fg={theme.yellow}>r</span>
        <span fg={theme.dim}> | </span>
        <span fg={theme.blue}>Q:</span> <span fg={theme.yellow}>q</span>
        <span fg={theme.dim}>{selectedText}{modeText}</span>
      </text>
    </box>
  );
}

function ListenerRow({ entry, focused, marked }: { entry: PortEntry; focused: boolean; marked: boolean }) {
  const attributes = marked || focused ? TextAttributes.BOLD : TextAttributes.NONE;
  const fg = focused || marked ? theme.activeFg : riskColor(entry.risk);
  const bg = focused && marked ? theme.selectedFocusBg : focused ? theme.focusBg : marked ? theme.selectedBg : undefined;
  const content = [
    riskBadge(entry.risk).padEnd(5),
    appBadge(entry.app).padEnd(8),
    String(entry.port).padStart(5),
    String(entry.pid ?? "-").padStart(7),
    commandLabel(entry).slice(0, 34)
  ].join(" ").padEnd(180);

  if (bg) return <text height={1} wrapMode="none" truncate fg={fg} bg={bg} attributes={attributes} content={content} />;
  return <text height={1} wrapMode="none" truncate fg={fg} attributes={attributes} content={content} />;
}

function Inspector({
  entry,
  activeTab,
  spinnerChar
}: {
  entry: PortEntry | undefined;
  activeTab: "details" | "connections" | "logs";
  spinnerChar: string;
}) {
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [connections, setConnections] = useState<ActiveConnection[]>([]);
  const [loadingConn, setLoadingConn] = useState<boolean>(false);

  useEffect(() => {
    if (!entry || activeTab !== "logs") {
      setLogs("");
      return;
    }

    let active = true;
    setLoading(true);
    setLogs("Obteniendo logs...");

    fetchProcessLogs(entry.pid ?? 0, entry.container)
      .then((res) => {
        if (active) {
          const clean = res.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").trim();
          setLogs(clean || "[El proceso no ha generado líneas de log o están vacías]");
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setLogs(`[Error al cargar logs: ${err.message}]`);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [entry?.pid, entry?.container?.id, activeTab]);

  useEffect(() => {
    if (!entry || activeTab !== "connections") {
      setConnections([]);
      return;
    }

    let active = true;
    setLoadingConn(true);

    fetchActiveConnections(entry.port)
      .then((res) => {
        if (active) {
          setConnections(res);
          setLoadingConn(false);
        }
      })
      .catch((err) => {
        if (active) {
          setConnections([]);
          setLoadingConn(false);
        }
      });

    return () => {
      active = false;
    };
  }, [entry?.port, activeTab]);

  if (!entry) {
    return (
      <Fragment key="no-listener">
        <text key="no-listener-selected" fg={theme.dim} content="No listener selected" />
        <text key="no-listener-help" fg={theme.dim} content="Use / to filter by app, port, pid, cwd, or command." />
      </Fragment>
    );
  }

  if (activeTab === "connections") {
    if (loadingConn) {
      return <text key="conn-loading" fg={theme.yellow} content={`${spinnerChar} Obteniendo conexiones activas...`} />;
    }

    if (connections.length === 0) {
      return <text key="conn-empty" fg={theme.dim} content="No hay conexiones activas en este puerto." />;
    }

    return (
      <Fragment key="conn-list">
        <text key="conn-header" height={1} attributes={TextAttributes.BOLD} content="PROTO  REMOTE ADDRESS          STATE" />
        {connections.map((conn, idx) => {
          const remoteStr = `${conn.remoteAddress}:${conn.remotePort}`;
          const protoStr = conn.protocol.toUpperCase().padEnd(6);
          const remStr = remoteStr.slice(0, 23).padEnd(23);
          const stateStr = conn.state;
          const content = `${protoStr} ${remStr} ${stateStr}`;
          
          return (
            <text key={`conn-item-${idx}`} height={1} wrapMode="none" truncate fg={theme.dim} content={content || ""} />
          );
        })}
      </Fragment>
    );
  }

  if (activeTab === "logs") {
    if (loading) {
      return <text key="logs-loading" fg={theme.yellow} content={`${spinnerChar} Obteniendo logs...`} />;
    }
    const lines = logs.split("\n");
    return (
      <Fragment key="logs-list">
        {lines.map((line, idx) => (
          <text key={`logs-item-${idx}`} height={1} wrapMode="none" truncate fg={theme.dim} content={line || ""} />
        ))}
      </Fragment>
    );
  }

  return (
    <Fragment key="details-view">
      <text key="detail-app" height={1}>
        <span fg={theme.green}>App</span> {appName(entry.app)}
      </text>
      <text key="detail-risk" height={1}>
        <span fg={riskColor(entry.risk)}>Risk {riskSymbol(entry.risk)}</span> {riskLabel(entry.risk)}
      </text>
      <text key="detail-port-pid" height={1}>
        <span fg={theme.yellow}>Port</span> {entry.port}  <span fg={theme.yellow}>PID</span> {entry.pid ?? "-"}
      </text>
      <text key="detail-endpoint" height={1}>
        <span fg={theme.blue}>Endpoint</span> {entry.protocol.toUpperCase()} {entry.address}:{entry.port}  <span fg={theme.blue}>State</span> {entry.state}
      </text>
      <text key="detail-owner" height={1}>
        <span fg={theme.blue}>Owner</span> {entry.user ?? "-"}  <span fg={theme.blue}>UID</span> {entry.uid ?? "-"}
      </text>
      <text key="detail-inode" height={1}>
        <span fg={theme.blue}>Inode</span> {entry.inode}  <span fg={theme.blue}>Detection</span> {Math.round(entry.detection.confidence * 100)}%
      </text>
      <text key="detail-proc-title" height={1} fg={theme.blue} content="Process" />
      <text key="detail-name" height={1}>
        <span fg={theme.yellow}>Name</span> {entry.name ?? "-"}
      </text>
      <text key="detail-command" height={1}>
        <span fg={theme.yellow}>Command</span> {entry.cmdline ?? entry.exe ?? "-"}
      </text>
      <text key="detail-binary" height={1}>
        <span fg={theme.blue}>Binary</span> {entry.exe ?? "-"}
      </text>
      <text key="detail-cwd" height={1}>
        <span fg={theme.blue}>CWD</span> {entry.cwd ?? "-"}
      </text>
      <text key="detail-evidence" height={1}>
        <span fg={theme.blue}>Evidence</span> {entry.detection.evidence.join(", ") || "no detection evidence"}
      </text>
      {entry.container ? (
        <Fragment key="detail-container-group">
          <text key="detail-container-title" height={1} fg={theme.blue} content="Container" />
          <text key="detail-container-image-row" height={1}>
            <span fg={theme.yellow}>Engine</span> {entry.container.engine}  <span fg={theme.yellow}>Name</span> {entry.container.name ?? "-"}
          </text>
          <text key="detail-container-image" height={1}>
            <span fg={theme.blue}>Image</span> {shortImageName(entry.container.image)}
          </text>
          <text key="detail-container-ports" height={1}>
            <span fg={theme.blue}>Ports</span> {entry.container.ports.map(formatContainerPort).join(", ") || "-"}
          </text>
          <text key="detail-container-evidence" height={1}>
            <span fg={theme.blue}>Container evidence</span> {entry.container.evidence.join(", ")}
          </text>
        </Fragment>
      ) : null}
      {entry.permissionDenied ? <text key="detail-permission-denied" height={1} fg={theme.yellow} content="Permissions partial /proc data" /> : null}
    </Fragment>
  );
}

function AppSummary({
  entries,
  appCounts,
  total
}: {
  entries: PortEntry[];
  appCounts: Array<[string, number]>;
  total: number;
}) {
  const low = entries.filter((e) => e.risk === "low").length;
  const medium = entries.filter((e) => e.risk === "medium").length;
  const high = entries.filter((e) => e.risk === "high").length;

  return (
    <Fragment key="summary-view">
      <text key="summary-total" height={1}>
        <span fg={theme.blue}>Listeners:</span> {total}
      </text>
      <text key="summary-risk" height={1}>
        <span fg={theme.blue}>Risk:</span> <span fg={theme.green}>L:{low}</span>  <span fg={theme.yellow}>M:{medium}</span>  <span fg={theme.red}>H:{high}</span>
      </text>
      {appCounts.slice(0, 3).map(([app, count]) => {
        const { filled, empty } = barParts(count, total);
        return (
          <text key={`summary-app-${app}`} height={1}>
            {app.padEnd(9)} <span fg={appColor(app)}>{filled}</span><span fg={theme.dim}>{empty}</span> {count}
          </text>
        );
      })}
    </Fragment>
  );
}

function Overlay({ state, filteredCount }: { state: TuiState; filteredCount: number }) {
  if (state.mode === "confirm" && state.pendingKillEntries.length > 0) {
    return <ConfirmModal entries={state.pendingKillEntries} force={false} />;
  }
  if (state.mode === "force-confirm" && state.pendingKillEntries.length > 0) {
    return <ConfirmModal entries={state.pendingKillEntries} force />;
  }
  if (state.mode === "search") {
    return (
      <CenterModal title="Search" height={5}>
        <text height={1} content={`/${state.command}`} />
        <text height={1} fg={theme.dim} content={`${filteredCount} matches. Enter applies, Esc cancels.`} />
      </CenterModal>
    );
  }
  if (state.mode === "command") {
    return (
      <CenterModal title="Command" height={5}>
        <text height={1} content={`:${state.command}`} />
        <text height={1} fg={theme.dim} content="kill 3000  |  kill-pid 1234  |  filter next  |  refresh  |  quit" />
      </CenterModal>
    );
  }
  if (state.mode === "help") {
    return (
      <CenterModal title="Help" height={11}>
        <text>j/k move   gg/G top/bottom   / live search   d kill selected</text>
        <text>p toggle private port   Tab/h/l navigate tabs</text>
        <text>: command line (:p [port] / :release [port])   r refresh   q quit</text>
        <text fg={theme.dim}>Kill policy: SIGTERM first. SIGKILL needs a second confirmation.</text>
        <text fg={theme.dim}>High-risk services are highlighted before any signal is sent.</text>
      </CenterModal>
    );
  }
  return null;
}

function ConfirmModal({ entries, force }: { entries: PortEntry[]; force: boolean }) {
  const title = force ? "Force kill?" : entries.length > 1 ? "Kill listeners?" : "Kill listener?";
  const signal = force ? "SIGKILL" : "SIGTERM";
  const ports = entries.map((entry) => entry.port).join(", ");
  const primary = entries[0];
  return (
    <CenterModal title={title} height={8} hot>
      <text fg={force ? theme.red : theme.yellow}>{`${signal} ${entries.length} selected listener${entries.length === 1 ? "" : "s"}`}</text>
      <text>{entries.length === 1 && primary ? `${primary.protocol.toUpperCase()} ${primary.address}:${primary.port}  pid ${primary.pid ?? "-"}` : `ports ${ports}`}</text>
      <text fg={theme.dim}>{entries.length === 1 && primary ? commandLabel(primary).slice(0, 92) : `${entries.length} processes will receive ${signal}`}</text>
      {entries.some((entry) => entry.risk === "high") ? <text fg={theme.red}>High-risk target. Double-check before confirming.</text> : null}
      <ModalKeyFooter />
    </CenterModal>
  );
}

function ModalKeyFooter() {
  return (
    <text height={1}>
      <span fg={theme.blue}>Confirm:</span> <span fg={theme.yellow}>y/Enter</span>
      <span fg={theme.dim}> | </span>
      <span fg={theme.blue}>Cancel:</span> <span fg={theme.yellow}>n/Esc</span>
    </text>
  );
}

function CenterModal({ title, height, hot, children }: { title: string; height: number; hot?: boolean; children: React.ReactNode }) {
  return (
    <box
      position="absolute"
      top="38%"
      left="7%"
      width="86%"
      height={height}
      zIndex={20}
      border
      borderStyle={cardBorderStyle}
      borderColor={hot ? theme.borderHot : theme.border}
      backgroundColor={theme.surface}
      title={title}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
    >
      {children}
    </box>
  );
}

function handleKey(
  state: TuiState,
  key: KeyEvent,
  renderer: Awaited<ReturnType<typeof createCliRenderer>>,
  refresh: (customStatus?: string) => Promise<void>
): TuiState {
  if (state.mode === "search" || state.mode === "command") {
    if (isEscape(key)) return { ...state, mode: "normal", command: "" };
    if (isBackspace(key)) return { ...state, command: state.command.slice(0, -1), selected: 0 };
    if (isEnter(key)) return applyLineInput(state, renderer, refresh);
    const text = keyText(key);
    if (text) return { ...state, command: state.command + text, selected: 0 };
    return state;
  }

  if (state.mode === "confirm" || state.mode === "force-confirm") {
    if (isEscape(key) || key.name === "n" || key.sequence === "n") {
      return { ...state, mode: "normal", pendingKillEntries: [] };
    }
    if ((key.name === "y" || key.sequence === "y" || isEnter(key)) && state.pendingKillEntries.length > 0) {
      const pendingKillEntries = state.pendingKillEntries;
      void executeKillPlan(planKillEntries(pendingKillEntries), {
        confirmed: true,
        forceConfirmed: state.mode === "force-confirm"
      }).then((result) => {
        if (result.status === "terminated" || result.status === "killed") void refresh();
      });
      return {
        ...state,
        mode: state.mode === "confirm" ? "force-confirm" : "normal",
        selectedKeys: state.mode === "force-confirm" ? [] : state.selectedKeys
      };
    }
    return state;
  }

  const filteredLength = filterEntries(state.entries, state.filter).length;
  if (key.name === "q" || key.sequence === "q") return { ...state, quitRequested: true };
  if (key.name === "?" || key.sequence === "?") return { ...state, mode: state.mode === "help" ? "normal" : "help" };
  if (key.name === "/" || key.sequence === "/") return { ...state, mode: "search", command: "", selected: 0 };
  if (key.name === ":" || key.sequence === ":") return { ...state, mode: "command", command: "" };
  if (key.name === "tab") {
    const tabs: Array<"details" | "connections" | "logs"> = ["details", "connections", "logs"];
    const currentIdx = tabs.indexOf(state.inspectorTab);
    const nextIdx = (currentIdx + 1) % tabs.length;
    return {
      ...state,
      inspectorTab: tabs[nextIdx] ?? "details"
    };
  }
  if (key.name === "h" || key.sequence === "h" || key.name === "left") {
    const tabs: Array<"details" | "connections" | "logs"> = ["details", "connections", "logs"];
    const currentIdx = tabs.indexOf(state.inspectorTab);
    const nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
    return {
      ...state,
      inspectorTab: tabs[nextIdx] ?? "details"
    };
  }
  if (key.name === "l" || key.sequence === "l" || key.name === "right") {
    const tabs: Array<"details" | "connections" | "logs"> = ["details", "connections", "logs"];
    const currentIdx = tabs.indexOf(state.inspectorTab);
    const nextIdx = (currentIdx + 1) % tabs.length;
    return {
      ...state,
      inspectorTab: tabs[nextIdx] ?? "details"
    };
  }
  if (key.name === "p" || key.sequence === "p") {
    const target = filterEntries(state.entries, state.filter)[state.selected];
    if (target) {
      const port = target.port;
      if (privationManager.isPrivated(port)) {
        void privationManager.liberarPort(port).then((success) => {
          if (success) {
            void refresh(`Puerto ${port} liberado`);
          } else {
            void refresh(`Error al liberar puerto ${port}`);
          }
        });
        return { ...state, status: `Liberando puerto ${port}...` };
      } else {
        void privationManager.privarPort(port).then((success) => {
          if (success) {
            void refresh(`Puerto ${port} reservado con éxito`);
          } else {
            void refresh(`Error: El puerto ${port} ya está en uso o requiere privilegios`);
          }
        });
        return { ...state, status: `Reservando puerto ${port}...` };
      }
    }
  }
  if (isSpace(key)) {
    const target = filterEntries(state.entries, state.filter)[state.selected];
    if (!target) return state;
    const key = socketKey(target);
    const selectedKeys = state.selectedKeys.includes(key)
      ? state.selectedKeys.filter((selectedKey) => selectedKey !== key)
      : [...state.selectedKeys, key];
    return { ...state, selectedKeys };
  }
  if (key.name === "r" || key.sequence === "r") {
    void refresh();
    return { ...state, status: "Refreshing..." };
  }
  if (key.name === "j" || key.sequence === "j" || key.name === "down") {
    return { ...state, selected: Math.min(state.selected + 1, Math.max(filteredLength - 1, 0)) };
  }
  if (key.name === "k" || key.sequence === "k" || key.name === "up") {
    return { ...state, selected: Math.max(state.selected - 1, 0) };
  }
  if (key.name === "G" || key.sequence === "G") return { ...state, selected: Math.max(filteredLength - 1, 0) };
  if (key.name === "g" || key.sequence === "g") return { ...state, selected: 0 };
  if (key.name === "d" || key.sequence === "d" || isEnter(key)) {
    const targets = killTargets(state, filterEntries(state.entries, state.filter));
    if (targets.length > 0) return { ...state, mode: "confirm", pendingKillEntries: targets };
  }

  return state;
}

function applyLineInput(
  state: TuiState,
  _renderer: Awaited<ReturnType<typeof createCliRenderer>>,
  refresh: (customStatus?: string) => Promise<void>
): TuiState {
  if (state.mode === "search") {
    return { ...state, mode: "normal", filter: state.command.trim(), selected: 0, command: "" };
  }

  const command = state.command.trim();
  if (command === "quit" || command === "q") return { ...state, quitRequested: true };
  if (command === "refresh") {
    void refresh();
    return { ...state, mode: "normal", command: "", status: "Refreshing..." };
  }
  if (command.startsWith("filter ")) {
    return { ...state, mode: "normal", command: "", filter: command.slice("filter ".length).trim(), selected: 0 };
  }
  if (command.startsWith("kill ")) {
    const port = Number.parseInt(command.slice("kill ".length), 10);
    const pendingKillEntries = state.entries.filter((entry) => entry.port === port);
    return pendingKillEntries.length > 0
      ? { ...state, mode: "confirm", pendingKillEntries, command: "" }
      : { ...state, mode: "normal", command: "", status: `No socket on port ${port}` };
  }
  if (command.startsWith("kill-pid ")) {
    const pid = Number.parseInt(command.slice("kill-pid ".length), 10);
    const pendingKillEntries = state.entries.filter((entry) => entry.pid === pid);
    return pendingKillEntries.length > 0
      ? { ...state, mode: "confirm", pendingKillEntries, command: "" }
      : { ...state, mode: "normal", command: "", status: `No socket for PID ${pid}` };
  }
  if (command.startsWith("private ") || command.startsWith("p ")) {
    const portStr = command.startsWith("private ") ? command.slice("private ".length) : command.slice("p ".length);
    const port = Number.parseInt(portStr, 10);
    if (!Number.isNaN(port)) {
      void privationManager.privarPort(port).then((success) => {
        if (success) {
          void refresh(`Puerto ${port} reservado con éxito`);
        } else {
          void refresh(`Error: El puerto ${port} ya está en uso o requiere privilegios`);
        }
      });
      return { ...state, mode: "normal", command: "", status: `Reservando puerto ${port}...` };
    }
  }
  if (command.startsWith("release ") || command.startsWith("r ")) {
    const portStr = command.startsWith("release ") ? command.slice("release ".length) : command.slice("r ".length);
    const port = Number.parseInt(portStr, 10);
    if (!Number.isNaN(port)) {
      void privationManager.liberarPort(port).then((success) => {
        if (success) {
          void refresh(`Puerto ${port} liberado`);
        } else {
          void refresh(`Error: El puerto ${port} no estaba reservado`);
        }
      });
      return { ...state, mode: "normal", command: "", status: `Liberando puerto ${port}...` };
    }
  }

  return { ...state, mode: "normal", command: "", status: `Unknown command: ${command}` };
}

function filterEntries(entries: PortEntry[], filter: string): PortEntry[] {
  const needle = filter.toLowerCase().trim();
  if (!needle) return entries;
  return entries.filter((entry) =>
    [
      entry.protocol,
      entry.address,
      entry.port,
      entry.pid,
      entry.app,
      entry.risk,
      entry.cmdline,
      entry.cwd,
      entry.exe,
      entry.detection.evidence.join(" ")
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
}

function killTargets(state: TuiState, filtered: PortEntry[]): PortEntry[] {
  if (state.selectedKeys.length > 0) {
    return state.entries.filter((entry) => state.selectedKeys.includes(socketKey(entry)));
  }
  const target = filtered[state.selected];
  return target ? [target] : [];
}

function socketKey(entry: PortEntry): string {
  return `${entry.protocol}:${entry.inode}:${entry.pid ?? "none"}:${entry.port}`;
}

function visibleRows(entries: PortEntry[], selected: number, count: number): Array<{ entry: PortEntry; index: number }> {
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), Math.max(entries.length - count, 0)));
  return entries.slice(start, start + count).map((entry, offset) => ({ entry, index: start + offset }));
}

function summarizeApps(entries: PortEntry[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.app, (counts.get(entry.app) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function modeLine(state: TuiState): string {
  if (state.mode === "search") return `search /${state.command}`;
  if (state.mode === "command") return `command :${state.command}`;
  if (state.filter) return `filter ${state.filter}`;
  return "normal";
}

function commandLabel(entry: PortEntry): string {
  return entry.cmdline ?? entry.exe ?? "unknown process";
}

function appName(app: AppKind): string {
  const labels: Record<AppKind, string> = {
    nextjs: "nextjs",
    nestjs: "nestjs",
    vite: "vite",
    node: "node",
    bun: "bun",
    deno: "deno",
    postgres: "postgres",
    redis: "redis",
    mysql: "mysql",
    mongodb: "mongodb",
    elasticsearch: "elastic",
    rabbitmq: "rabbitmq",
    memcached: "memcached",
    docker: "docker",
    podman: "podman",
    mcp: "mcp",
    apache: "apache",
    nginx: "nginx",
    caddy: "caddy",
    lighttpd: "lighttpd",
    traefik: "traefik",
    haproxy: "haproxy",
    envoy: "envoy",
    php: "php",
    python: "python",
    java: "java",
    ruby: "ruby",
    ssh: "ssh",
    dns: "dns",
    web: "web",
    dhcp: "dhcp",
    chrony: "chrony",
    cups: "cups",
    mdns: "mdns",
    llmnr: "llmnr",
    gsconnect: "gsconnect",
    wsdd: "wsdd",
    engram: "engram",
    opendesign: "open-design",
    system: "system",
    program: "program",
    portki: "portki",
    unknown: "unknown"
  };
  return labels[app];
}

function appBadge(app: AppKind): string {
  const labels: Record<AppKind, string> = {
    nextjs: "[NEXT]",
    nestjs: "[NEST]",
    vite: "[VITE]",
    node: "[NODE]",
    bun: "[BUN]",
    deno: "[DENO]",
    postgres: "[PG]",
    redis: "[REDIS]",
    mysql: "[MYSQL]",
    mongodb: "[MONGO]",
    elasticsearch: "[ES]",
    rabbitmq: "[AMQP]",
    memcached: "[CACHE]",
    docker: "[DOCKER]",
    podman: "[POD]",
    mcp: "[MCP]",
    apache: "[HTTPD]",
    nginx: "[NGINX]",
    caddy: "[CADDY]",
    lighttpd: "[LIGHT]",
    traefik: "[TRAEF]",
    haproxy: "[HAPRO]",
    envoy: "[ENVOY]",
    php: "[PHP]",
    python: "[PY]",
    java: "[JAVA]",
    ruby: "[RUBY]",
    ssh: "[SSH]",
    dns: "[DNS]",
    web: "[WEB]",
    dhcp: "[DHCP]",
    chrony: "[NTP]",
    cups: "[CUPS]",
    mdns: "[MDNS]",
    llmnr: "[LLMNR]",
    gsconnect: "[GSCON]",
    wsdd: "[WSDD]",
    engram: "[ENGRM]",
    opendesign: "[OD]",
    system: "[SYS]",
    program: "[PROC]",
    portki: "[PORTK]",
    unknown: "[?]"
  };
  return labels[app];
}

function riskBadge(risk: RiskLevel): string {
  if (risk === "high") return "[!!]";
  if (risk === "medium") return "[!]";
  return "[OK]";
}

function riskSymbol(risk: RiskLevel): string {
  if (risk === "high") return "!!";
  if (risk === "medium") return "!";
  return "OK";
}

function riskLabel(risk: RiskLevel): string {
  if (risk === "high") return "High";
  if (risk === "medium") return "Medium";
  return "Low";
}

function riskColor(risk: RiskLevel): RGBA {
  if (risk === "high") return theme.red;
  if (risk === "medium") return theme.yellow;
  return theme.green;
}

function barParts(count: number, total: number): { filled: string; empty: string } {
  const width = 8;
  const filled = total > 0 ? Math.max(1, Math.round((count / total) * width)) : 0;
  return {
    filled: "█".repeat(filled),
    empty: "░".repeat(width - filled)
  };
}

function appColor(app: string): RGBA {
  if (["postgres", "redis", "mysql", "mongodb", "elasticsearch", "rabbitmq", "memcached"].includes(app)) return theme.red;
  if (["podman", "docker", "apache", "nginx", "caddy", "traefik", "haproxy", "envoy", "dns", "dhcp", "chrony", "cups", "mdns", "llmnr", "passim", "system"].includes(app)) return theme.yellow;
  if (["nextjs", "nestjs", "vite", "node", "bun", "deno", "opendesign", "portki"].includes(app)) return theme.green;
  if (["mcp", "gsconnect", "wsdd", "engram", "python", "php", "java", "ruby"].includes(app)) return theme.blue;
  return theme.dim;
}

function formatContainerPort(port: NonNullable<PortEntry["container"]>["ports"][number]): string {
  const protocol = port.protocol ?? "tcp";
  return `${port.hostPort}->${port.containerPort ?? "?"}/${protocol}`;
}

function shortImageName(image: string | undefined): string {
  if (!image) return "-";
  const withoutDigest = image.split("@")[0] ?? image;
  return withoutDigest.split("/").at(-1) ?? withoutDigest;
}

function keyText(key: KeyEvent): string | undefined {
  if (typeof key.sequence === "string" && key.sequence.length === 1 && key.sequence >= " ") return key.sequence;
  if (typeof key.name === "string" && key.name.length === 1 && key.name >= " ") return key.name;
  return undefined;
}

function isEnter(key: KeyEvent): boolean {
  return key.name === "return" || key.name === "enter" || key.name === "linefeed" || key.sequence === "\r" || key.sequence === "\n";
}

function isSpace(key: KeyEvent): boolean {
  return key.name === "space" || key.name === " " || key.sequence === " " || key.sequence === "space";
}

function isEscape(key: KeyEvent): boolean {
  return key.name === "escape" || key.sequence === "\u001b";
}

function isBackspace(key: KeyEvent): boolean {
  return key.name === "backspace" || key.sequence === "\b" || key.sequence === "\u007f";
}
