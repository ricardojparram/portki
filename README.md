<h1 align="center">portki</h1>

<p align="center">
  <strong>A Linux TUI for inspecting local port listeners and safely stopping them with a conservative kill policy.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/portki-tui?color=brightgreen&style=flat-square" alt="NPM Version">
  <img src="https://img.shields.io/github/license/ricardojparram/portki?color=blue&style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/platform-linux-lightgrey?style=flat-square" alt="Platform Linux">
  <img src="https://img.shields.io/badge/dependencies-zero%20(standalone)-orange?style=flat-square" alt="Zero Dependencies">
</p>

---

`portki` is built for developer machines where ports are constantly occupied by Next.js, NestJS, Vite, Docker, Podman, databases, and background services. The scanner reads the Linux `/proc` filesystem directly, meaning normal usage has **zero dependencies** on `lsof`, `ss`, or `fuser`.

## Preview

![PORTKI TUI preview](assets/preview.gif)

---

## Features

### 🔍 Core Inspector
- **Dense lazygit-style UI**: Interactive listener list, summary charts, and modal confirmations.
- **Traffic Inspector**: View active socket connections (`ESTABLISHED`, `TIME_WAIT`, etc.) for the selected port.
- **Live Process Logs**: View the stdout/stderr stream from processes, including native Docker and Podman container logs.
- **Direct `/proc` Parsing**: Extreme speed and low resource usage without executing external utilities.

### 🛡️ Conservative Kill Flow
- **Wholesome Safety Model**: Never sends `SIGKILL` first. Sends `SIGTERM`, waits, and requires a second confirmation before sending `SIGKILL` to remaining processes.
- **Group Killing**: Select multiple listeners with `<space>` and terminate them collectively.
- **Protected Processes**: Automatically blocks attempts to kill PID 1, protected system processes, or the running `portki` instance.
- **Risk Assessment**: Highlights infrastructure listeners (databases, reverse proxies, web servers, SSH) as high-risk targets.

### 🔌 Extensible Integrations
- **App Detection**: Built-in detection signatures for Next.js, NestJS, Vite, Node, Bun, Docker, Podman, Postgres, Redis, Nginx, Caddy, Apache, system services, and more.
- **Docker/Podman Enrichment**: Matches published ports back to their parent container name, ID, and image.
- **CLI & Scripting**: Output structured JSON for scripts with `portki list --json`.

---

## Installation

You can install `portki` using either the standalone binary or npm:

| Feature | Standalone Binary (Recommended) | NPM Package (`portki-tui`) |
| :--- | :--- | :--- |
| **Dependencies** | None (Zero-dependency binary) | Node.js `>=20` and Bun |
| **Updates** | Via install script | `npm update -g portki-tui` |
| **Target OS** | Linux (x64 / arm64) | Linux |

### Option 1: Standalone Binary (Zero dependencies)
Run the automated installer:
```sh
curl -fsSL https://raw.githubusercontent.com/ricardojparram/portki/main/install.sh | sh
```
The installer automatically detects your processor architecture (x86_64 vs arm64), downloads the compiled standalone binary from the latest GitHub Release, and registers it under your path.

### Option 2: NPM Package
```sh
npm install -g portki-tui
```
> [!IMPORTANT]
> If installing via npm, you must have Bun installed on your system to run the interactive TUI.

---

## Usage

### Interactive TUI Mode
Launch the main TUI:
```sh
portki
```

### Scriptable Commands
Output active listeners in JSON format:
```sh
portki list --json
```

Verify your environment permissions and check for optional diagnostic tools:
```sh
portki doctor
```

Kill specific ports or PIDs using the same safe policy as the TUI:
```sh
portki kill 3000 --safe
portki kill 3000 --safe --force
```

---

## Controls & Keyboard Shortcuts

### Navigation & Actions
| Shortcut | Action |
| :--- | :--- |
| `j` / `k` | Navigate up / down in the listener list |
| `g` / `G` | Jump to the top / bottom of the list |
| `<space>` | Select / Deselect multiple items |
| `d` | Initiate safe kill flow on selected items |
| `r` | Manually reload / refresh listeners |
| `/` | Enter Live Filter mode |
| `:` | Open Command Line mode |
| `Tab` / `h` / `l` | Alternate tabs in the Inspector pane (`Details` ⇄ `Connections` ⇄ `Logs`) |
| `?` | Toggle Help Modal |
| `q` / `Esc` | Quit / Close active Modal |

### Command Mode (`:`)
Press `:` to open the command line in the TUI:
- `:kill <port>` - Kill a listener on a port.
- `:kill-pid <pid>` - Kill a specific process ID.
- `:p <port>` or `:private <port>` - Reserve/monopolize a local port.
- `:release <port>` - Free a reserved port.
- `:refresh` - Reload listeners list.
- `:quit` - Exit `portki`.

---

## Development

`portki` uses Node.js for lightweight CLI/JSON scripts and Bun for the high-performance OpenTUI FFI runtime.

```sh
# Clone the repository
git clone https://github.com/ricardojparram/portki.git
cd portki

# Install dependencies
bun install

# Run test suite
bun test

# Run build & compilation
bun run build
```

Run your local build:
```sh
bun run build
./bin/portki
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
