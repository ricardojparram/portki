# PORTKI

`portki` is a Bun-powered Linux TUI for inspecting local port listeners and stopping them with a conservative kill policy.

It reads `/proc` as the primary source, so normal usage does not require `lsof`, `ss`, or `fuser`.

## Install

```sh
npm install -g portki
```

`portki` requires Bun at runtime:

```sh
curl -fsSL https://bun.sh/install | bash
```

For local development from this repo:

```sh
bun install
bun run build
npm install -g .
portki
```

## Commands

```sh
portki
portki list --json
portki kill <port|pid> --safe
portki kill <port|pid> --safe --force
```

## TUI controls

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

Kill confirmations accept `y` or `Enter`. `SIGTERM` is always attempted before `SIGKILL`; force kill requires a second confirmation.

## Safety model

- Blocks unresolved PIDs, PID 1, and the running `portki` process.
- Marks infrastructure listeners such as Postgres, Redis, MySQL, Docker, and Podman as high risk.
- Shows partial data when `/proc` permissions prevent reading process details.
- Never asks for sudo.

## Development

```sh
bun test
bun run check
bun run build
bun run pack:dry-run
```

Before publishing:

```sh
bun run release:check
npm publish
```

## GitHub setup

Recommended first push:

```sh
git add .
git commit -m "feat: prepare portki"
git remote add origin https://github.com/ricardojparram/portki.git
git push -u origin main
```

The CI workflow runs typecheck, tests, build, and npm package dry-run on every push and pull request.
