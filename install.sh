#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  printf '%s\n' "portki currently supports Linux only."
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)
    ASSET_NAME="portki-linux-x64"
    ;;
  aarch64|arm64)
    ASSET_NAME="portki-linux-arm64"
    ;;
  *)
    printf '%s\n' "Unsupported architecture: $ARCH. portki currently supports x86_64 and arm64."
    exit 1
    ;;
esac

if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_CMD="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_CMD="wget -qO-"
else
  printf '%s\n' "portki requires curl or wget to download the binary."
  exit 127
fi

PORTKI_REPO_OWNER="ricardojparram"
PORTKI_REPO_NAME="portki"
PORTKI_VERSION="${PORTKI_VERSION:-latest}"

if [ "$PORTKI_VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/${PORTKI_REPO_OWNER}/${PORTKI_REPO_NAME}/releases/latest/download/${ASSET_NAME}"
else
  DOWNLOAD_URL="https://github.com/${PORTKI_REPO_OWNER}/${PORTKI_REPO_NAME}/releases/download/${PORTKI_VERSION}/${ASSET_NAME}"
fi

# Detect installation directory
if [ -w "/usr/local/bin" ]; then
  BIN_DIR="/usr/local/bin"
  USE_SUDO="false"
elif [ -d "$HOME/.local/bin" ] && [ -w "$HOME/.local/bin" ] && printf '%s\n' "$PATH" | grep -q "$HOME/.local/bin"; then
  BIN_DIR="$HOME/.local/bin"
  USE_SUDO="false"
else
  BIN_DIR="/usr/local/bin"
  USE_SUDO="true"
fi

TEMP_FILE=$(mktemp)
trap 'rm -f "$TEMP_FILE"' EXIT HUP INT TERM

printf '%s\n' "Downloading portki standalone binary from GitHub..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_FILE"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TEMP_FILE" "$DOWNLOAD_URL"
fi

chmod +x "$TEMP_FILE"

printf '%s\n' "Installing portki to $BIN_DIR/portki..."
if [ "$USE_SUDO" = "true" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    printf '%s\n' "Error: sudo is required to install to /usr/local/bin, but was not found."
    exit 1
  fi
  sudo cp "$TEMP_FILE" "$BIN_DIR/portki"
else
  cp "$TEMP_FILE" "$BIN_DIR/portki"
fi

if ! command -v portki >/dev/null 2>&1; then
  printf '%s\n' "portki installed, but it was not found on PATH."
  printf '%s\n' "Make sure $BIN_DIR is in your PATH."
  exit 1
fi

printf '%s\n' "portki successfully installed!"
printf '%s\n' "Run: portki"
