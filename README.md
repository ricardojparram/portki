<pre>
██████╗  ██████╗ ██████╗ ████████╗██╗  ██╗██╗
██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝██║ ██╔╝██║
██████╔╝██║   ██║██████╔╝   ██║   █████╔╝ ██║
██╔═══╝ ██║   ██║██╔══██╗   ██║   ██╔═██╗ ██║
██║     ╚██████╔╝██║  ██║   ██║   ██║  ██╗██║
╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝
</pre>

`portki` is a Linux TUI for inspecting local port listeners and stopping them with a conservative kill policy.

It is built for developer machines where ports are constantly occupied by Next.js, NestJS, Vite, Docker, Podman, MCP servers, web servers, databases, and background tools. The scanner reads Linux `/proc` directly, so normal usage does not depend on `lsof`, `ss`, or `fuser`.

## Preview

![PORTKI TUI preview](assets/preview.png)

## Features

- Dense lazygit-style TUI with listener list, inspector, summary chart, search, command mode, and centered confirmations.
- Fast Linux scanner based on `/proc/net/*` plus `/proc/<pid>/fd` inode mapping.
- App detection for Next.js, NestJS, Vite, Node, Bun, Deno, Docker, Podman, MCP servers, Apache, Nginx, Caddy, Lighttpd, Traefik, HAProxy, Envoy, Postgres, Redis, MySQL, MongoDB, Elasticsearch, RabbitMQ, Memcached, SSH, DNS, Python, PHP, Java, Ruby, and generic programs.
- Low-confidence hints for unresolved sockets on well-known ports such as 22, 53, 80, 443, 5432, 6379, 3306, 27017, 9200, 5672, and 11211.
- Safe kill flow: `SIGTERM` first, short wait, second confirmation before `SIGKILL`.
- Group selection with `<space>` and grouped kill confirmation.
- Parseable CLI output for scripting with `portki list --json`.

## Install

Install from the GitHub source:

```sh
curl -fsSL https://raw.githubusercontent.com/ricardojparram/portki/main/install.sh | sh
```

The install script installs Bun automatically if it is not already available, clones this repository, builds `portki`, and installs it globally from the local checkout.

After `portki` is published to npm, manual npm install will also be available:

```sh
npm install -g portki
```

For manual npm installs, install Bun first if you want to use the interactive TUI.

Requirements:

- Linux with `/proc` mounted.
- Node.js `>=20.0.0` and npm for installation and non-TUI commands.
- Bun for the interactive TUI, because OpenTUI currently uses Bun FFI. The curl installer installs it for you.
- A terminal with truecolor support recommended.

## Usage

Open the TUI:

```sh
portki
```

The TUI path currently runs through Bun. Scriptable commands such as `portki list --json` and `portki kill ... --safe` run through Node.

List listeners as JSON:

```sh
portki list --json
```

Kill by port or PID using the same safe policy as the TUI:

```sh
portki kill 3000 --safe
portki kill 675399 --safe
portki kill 3000 --safe --force
```

## Controls

```text
Move: j/k | Select: <space> | Find: / | Command: : | Kill: d | Refresh: r | Quit: q
```

Command mode supports:

```text
:kill 3000
:kill-pid 1234
:filter next
:refresh
:quit
```

Kill confirmations accept `y` or `Enter`. `Esc` cancels modals and line input.

## Safety Model

- Blocks unresolved PIDs, PID 1, and the running `portki` process.
- Marks infrastructure listeners such as web servers, databases, SSH, DNS, Docker, and Podman as high risk.
- Never sends `SIGKILL` first.
- Requires a second confirmation before force killing remaining processes.
- Shows partial data when `/proc` permissions prevent reading process details.
- Never asks for sudo.

## Development

Runtime is hybrid for now: Node handles scriptable commands, while the interactive TUI uses Bun for OpenTUI FFI. Development also uses Bun for tests and bundling.

```sh
git clone https://github.com/ricardojparram/portki.git
cd portki
bun install
bun test
bun run check
bun run build
```

Run locally:

```sh
bun run build
./bin/portki
```

Install locally as a global command:

```sh
npm install -g .
portki
```

Release check:

```sh
bun run release:check
```

That command runs typecheck, tests, build, and `npm pack --dry-run`.

## Contributing

Contributions are welcome.

Good first areas:

- Precompiled standalone binaries for GitHub releases, so the TUI can run without requiring users to install Bun.
- App detection patterns for more frameworks, tools, and container helpers.
- Linux distro edge cases in `/proc` parsing.
- TUI layout improvements for small terminals.
- Tests for scanner fixtures, kill policy, and keyboard flows.
- Documentation and screenshots.

Before opening a PR:

```sh
bun install
bun run release:check
```

Please keep the kill policy conservative. Changes that send signals, infer risk, or expand process detection should include focused tests.

## Publishing

Publishing is manual for now:

```sh
bun run release:check
npm publish
```

The npm tarball is intentionally small and includes only:

- `assets/`
- `bin/`
- `dist/`
- `README.md`
- `LICENSE`
- `package.json`

## License

MIT
