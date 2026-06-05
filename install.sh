#!/usr/bin/env sh
set -eu

PORTKI_REPO="${PORTKI_REPO:-https://github.com/ricardojparram/portki.git}"
PORTKI_REF="${PORTKI_REF:-main}"

if [ "$(uname -s)" != "Linux" ]; then
  printf '%s\n' "portki currently supports Linux only."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "portki requires Node.js 20 or newer."
  printf '%s\n' "Install Node.js, then run this installer again."
  exit 127
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  printf '%s\n' "portki requires Node.js 20 or newer. Current: $(node -v)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' "portki installs through npm, but npm was not found."
  printf '%s\n' "Install npm, then run this installer again."
  exit 127
fi

if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' "portki installs from GitHub for now, but git was not found."
  printf '%s\n' "Install git, then run this installer again."
  exit 127
fi

if ! command -v bun >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1; then
    printf '%s\n' "portki's TUI currently requires Bun, but curl was not found."
    printf '%s\n' "Install curl or install Bun from https://bun.sh, then run this installer again."
    exit 127
  fi

  printf '%s\n' "Bun was not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | sh

  BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin"
  if [ -d "$BUN_BIN" ]; then
    PATH="$BUN_BIN:$PATH"
    export PATH
  fi

  if ! command -v bun >/dev/null 2>&1; then
    printf '%s\n' "Bun was installed, but it was not found on PATH for this shell."
    printf '%s\n' "Add $BUN_BIN to PATH, then run portki."
    exit 1
  fi
fi

WORKDIR=$(mktemp -d)
PORTKI_DIR="$WORKDIR/portki"
trap 'rm -rf "$WORKDIR"' EXIT HUP INT TERM

printf '%s\n' "Installing portki from GitHub..."
git clone --depth 1 --branch "$PORTKI_REF" "$PORTKI_REPO" "$PORTKI_DIR"

cd "$PORTKI_DIR"
bun install --frozen-lockfile
bun run build
npm install -g "$PORTKI_DIR"

if ! command -v portki >/dev/null 2>&1; then
  printf '%s\n' "portki installed, but it was not found on PATH."
  printf '%s\n' "Check your npm global bin directory: npm bin -g"
  exit 1
fi

printf '%s\n' "portki installed."
printf '%s\n' "Run: portki"
