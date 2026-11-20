#!/bin/bash
# Starts the build worker the way launchd needs it: with a usable PATH and its output in a log file.
# Installed and managed by scripts/mac-worker.sh; you can also run it by hand to see what launchd sees.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${APPSMEDJAN_WORKER_LOG:-$HOME/Library/Logs/appsmedjan-worker.log}"

# launchd starts programs with a bare PATH. Homebrew (node, xcodegen, idb_companion) and the places
# pipx and python.org put `idb` have to be added by hand.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.local/bin:/Library/Frameworks/Python.framework/Versions/Current/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LOG_TIMESTAMPS=1

mkdir -p "$(dirname "$LOG")"
# One old log is kept; a worker that runs for months would otherwise grow the file without end.
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 20000000 ]; then
  mv -f "$LOG" "$LOG.1"
fi
exec >>"$LOG" 2>&1

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [run-worker] starting in $REPO ($(node -v 2>/dev/null || echo 'node not found'))"

# A signing worker that runs without a desktop session has a keychain of its own (made by
# `scripts/mac-worker.sh keychain`), and Xcode can only sign while it is unlocked. The password goes in
# on standard input, so it never shows up in the process list.
KEYCHAIN="$HOME/Library/Keychains/appsmedjan-signing.keychain-db"
KEYCHAIN_PASSWORD_FILE="$HOME/.appsmedjan-keychain-password"
if [ -f "$KEYCHAIN" ] && [ -f "$KEYCHAIN_PASSWORD_FILE" ]; then
  if printf 'unlock-keychain -p "%s" "%s"\n' "$(cat "$KEYCHAIN_PASSWORD_FILE")" "$KEYCHAIN" | security -i; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [run-worker] signing keychain unlocked"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [run-worker] could not unlock the signing keychain; uploads will fail"
  fi
fi
cd "$REPO/worker" || exit 1
# exec: launchd's stop signal goes straight to the worker, which shuts its simulators down before exiting.
exec node --import tsx src/index.ts
