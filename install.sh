#!/usr/bin/env sh
set -eu

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

if ! command -v bun >/dev/null 2>&1; then
  printf '%s\n' "portki's TUI currently requires Bun because OpenTUI uses Bun FFI."
  printf '%s\n' "Install Bun from https://bun.sh, then run this installer again."
  printf '%s\n' "Standalone binary releases are planned so this requirement can go away."
  exit 127
fi

printf '%s\n' "Installing portki..."
npm install -g portki

if ! command -v portki >/dev/null 2>&1; then
  printf '%s\n' "portki installed, but it was not found on PATH."
  printf '%s\n' "Check your npm global bin directory: npm bin -g"
  exit 1
fi

printf '%s\n' "portki installed."
printf '%s\n' "Run: portki"
