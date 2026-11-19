#!/bin/bash
# Sets up and manages the Appsmedjan build worker on a Mac, so it runs unattended: it starts at
# login, restarts if it stops, and logs to a file. Made for rented Macs, works on your own too.
#
#   scripts/mac-worker.sh check                         what is in place and what is missing (changes nothing)
#   scripts/mac-worker.sh install --server wss://...    install tools, write settings, start the worker
#   scripts/mac-worker.sh status | logs | restart | stop | start
#   scripts/mac-worker.sh update                        fetch the latest code and restart
#   scripts/mac-worker.sh uninstall                     stop the worker and remove the launchd job
#
# Options for install:
#   --server URL          the server to connect to, for example wss://appsmedjan.fly.dev
#   --role ROLE           all (default), preview (simulators only) or signing (TestFlight only, no simulators)
#   --max-simulators N    simulators to run at once (default: from the Mac's memory)
#   --skip-tools          do not install anything with Homebrew
# The shared secret is read from the WORKER_TOKEN environment variable, or asked for without echo.
#
# Xcode itself is not installed by this script: it needs an Apple account. See README, "Hyrda Macar".
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="se.appsmedjan.worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/appsmedjan-worker.log"
ENV_FILE="$REPO/.env"
DOMAIN="gui/$(id -u)"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.local/bin:/Library/Frameworks/Python.framework/Versions/Current/bin:$PATH"

ok()   { printf '  ok       %s\n' "$1"; }
miss() { printf '  MISSING  %s\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }
note() { printf '  note     %s\n' "$1"; }
die()  { printf 'Error: %s\n' "$1" >&2; exit 1; }
PROBLEMS=0

have() { command -v "$1" >/dev/null 2>&1; }

# The value of KEY in .env, or nothing. Never printed by this script.
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true
}

# Sets KEY=VALUE in .env: replaces an existing line, otherwise appends one.
env_set() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if grep -qE "^$key=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    # Through the environment, so no character in the value is treated specially.
    K="$key" V="$value" awk 'BEGIN { FS = "=" } $1 == ENVIRON["K"] { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

memory_gb() { echo $(( $(sysctl -n hw.memsize) / 1073741824 )); }

# A booted simulator with an app in it takes roughly 3 to 4 GB; macOS and Xcode builds need the rest.
suggested_simulators() {
  local n=$(( ($(memory_gb) - 6) / 4 ))
  [ "$n" -lt 1 ] && n=1
  echo "$n"
}

node_ok() {
  have node || return 1
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'
}

gui_session() { launchctl print "$DOMAIN" >/dev/null 2>&1; }
job_loaded()  { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/run-worker.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>90</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>$LOG.launchd</string>
  <key>StandardErrorPath</key><string>$LOG.launchd</string>
</dict>
</plist>
EOF
}

cmd_check() {
  echo "Mac"
  [ "$(uname -s)" = "Darwin" ] && ok "macOS $(sw_vers -productVersion)" || miss "this is not macOS"
  [ "$(uname -m)" = "arm64" ] && ok "Apple silicon" || note "Intel Mac: works, but builds and simulators are much slower"
  ok "$(memory_gb) GB memory: room for about $(suggested_simulators) simulators at once"
  local free_gb
  free_gb="$(df -g / | awk 'NR == 2 { print $4 }')"
  if [ "$free_gb" -ge 40 ]; then ok "$free_gb GB free disk"; else note "$free_gb GB free disk: Xcode builds and simulators want 40 GB or more"; fi

  echo "Xcode"
  if xcodebuild -version >/dev/null 2>&1; then
    ok "$(xcodebuild -version | head -1)"
    if xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then ok "license accepted and first launch done"
    else miss "first launch not done: run 'sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch'"; fi
    local runtimes
    runtimes="$(xcrun simctl list runtimes 2>/dev/null | grep -c '^iOS' || true)"
    if [ "$runtimes" -gt 0 ]; then ok "$runtimes iOS simulator runtime(s)"
    else miss "no iOS simulator runtime: run 'xcodebuild -downloadPlatform iOS'"; fi
  else
    miss "Xcode (see README, \"Hyrda Macar\", for installing it on a Mac without a screen)"
  fi

  echo "Tools"
  have brew && ok "Homebrew" || miss "Homebrew (https://brew.sh)"
  if node_ok; then ok "Node $(node -v)"; else miss "Node 22.13 or later (brew install node)"; fi
  have xcodegen && ok "XcodeGen" || miss "XcodeGen (brew install xcodegen)"
  if have idb && have idb_companion; then ok "idb (taps, typing and a smooth video stream)"
  else note "idb is not complete: the preview will be view-only and slower"; fi

  echo "Worker"
  [ -d "$REPO/node_modules/tsx" ] && ok "dependencies installed" || miss "dependencies: run 'npm ci' in $REPO"
  [ -n "$(env_get SERVER_URL)" ] && ok "SERVER_URL is set" || note "SERVER_URL is not set: the worker would connect to ws://localhost:8787"
  [ -n "$(env_get WORKER_TOKEN)" ] && ok "WORKER_TOKEN is set" || miss "WORKER_TOKEN in $ENV_FILE"
  if gui_session; then ok "a desktop session is open (simulators need one)"
  else miss "no desktop session: log in on the Mac's screen (or over screen sharing) and turn on automatic login"; fi
  if pmset -g 2>/dev/null | awk 'BEGIN { r = 1 } $1 == "sleep" { r = ($2 == 0 ? 0 : 1) } END { exit r }'; then ok "the Mac does not go to sleep"
  else note "the Mac may go to sleep: run 'sudo pmset -a sleep 0 disksleep 0 displaysleep 0'"; fi
  if job_loaded; then ok "launchd job $LABEL is loaded"; else note "launchd job is not installed (scripts/mac-worker.sh install)"; fi

  echo
  if [ "$PROBLEMS" -eq 0 ]; then echo "Ready."; else echo "$PROBLEMS thing(s) missing."; return 1; fi
}

install_tools() {
  have brew || die "Homebrew is not installed. Install it from https://brew.sh (needs an administrator), then run this again."
  local formula
  for formula in node xcodegen pipx; do
    brew list --formula "$formula" >/dev/null 2>&1 || brew install "$formula"
  done
  # idb comes in two halves: the companion from Facebook's own tap, and the Python client.
  if ! have idb_companion; then
    brew tap facebook/fb
    # Homebrew wants third-party taps trusted explicitly before it installs from them.
    brew trust --formula facebook/fb/idb-companion 2>/dev/null || true
    brew install idb-companion || echo "  note     idb-companion did not install; the preview will be view-only"
  fi
  if ! have idb; then
    pipx install fb-idb || echo "  note     fb-idb did not install; the preview will be view-only"
  fi
}

cmd_install() {
  local server="" role="all" max="" skip_tools=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --server) server="${2:-}"; shift 2 ;;
      --role) role="${2:-}"; shift 2 ;;
      --max-simulators) max="${2:-}"; shift 2 ;;
      --skip-tools) skip_tools=1; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done
  case "$role" in all | preview | signing) ;; *) die "--role must be all, preview or signing" ;; esac
  [ -z "$server" ] && server="$(env_get SERVER_URL)"
  case "$server" in ws://* | wss://*) ;; *) die "give the server with --server wss://your-server (got '${server:-nothing}')" ;; esac
  [ -n "$max" ] || max="$(env_get MAX_SIMULATORS)"
  [ -n "$max" ] || max="$(suggested_simulators)"
  case "$max" in '' | *[!0-9]*) die "--max-simulators must be a number" ;; esac
  xcodebuild -version >/dev/null 2>&1 || die "Xcode is not installed. See README, \"Hyrda Macar\"."

  if [ "$skip_tools" -eq 0 ]; then
    echo "Installing tools"
    install_tools
  fi
  node_ok || die "Node 22.13 or later is needed"

  echo "Installing dependencies"
  (cd "$REPO" && npm ci --no-audit --no-fund)

  echo "Writing settings to $ENV_FILE"
  local token="${WORKER_TOKEN:-}"
  [ -n "$token" ] || token="$(env_get WORKER_TOKEN)"
  if [ -z "$token" ]; then
    [ -r /dev/tty ] || die "set WORKER_TOKEN in the environment (the same value as on the server)"
    printf 'WORKER_TOKEN (the same value as on the server, not shown while you type): ' >/dev/tty
    IFS= read -r -s token </dev/tty
    printf '\n' >/dev/tty
  fi
  [ -n "$token" ] || die "WORKER_TOKEN is empty"
  env_set SERVER_URL "$server"
  env_set WORKER_TOKEN "$token"
  env_set MAX_SIMULATORS "$max"
  case "$role" in
    preview) env_set PREVIEWS 1; env_set PUBLISH_FOR_USERS 0 ;;
    # A signing-only Mac runs no simulators, so no app code written by the model runs next to the keys.
    signing) env_set PREVIEWS 0; env_set PUBLISH_FOR_USERS 1 ;;
    all) ;;
  esac

  gui_session || die "no desktop session is open for $(id -un). Log in on the Mac's screen or over screen sharing, turn on automatic login, and run this again."
  echo "Installing the launchd job"
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  plist >"$PLIST"
  plutil -lint "$PLIST" >/dev/null
  job_loaded && launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"

  echo "Started. Role: $role, simulators at once: $max, server: $server"
  echo "Follow it with: scripts/mac-worker.sh logs"
}

cmd_status() {
  if job_loaded; then
    launchctl print "$DOMAIN/$LABEL" | grep -E '^\s*(state|pid|last exit code) =' | sed 's/^[[:space:]]*/  /'
  else
    echo "  not installed"
  fi
  [ -f "$LOG" ] && { echo "  last lines of $LOG:"; tail -5 "$LOG" | sed 's/^/    /'; } || true
}

cmd_update() {
  (cd "$REPO" && git pull --ff-only && npm ci --no-audit --no-fund)
  job_loaded && launchctl kickstart -k "$DOMAIN/$LABEL" && echo "Restarted with the new code."
}

case "${1:-}" in
  check) cmd_check ;;
  install) shift; cmd_install "$@" ;;
  plist) plist ;;
  status) cmd_status ;;
  logs) exec tail -n 50 -f "$LOG" ;;
  start) launchctl bootstrap "$DOMAIN" "$PLIST" ;;
  stop) launchctl bootout "$DOMAIN/$LABEL" ;;
  restart) launchctl kickstart -k "$DOMAIN/$LABEL" ;;
  update) cmd_update ;;
  uninstall) job_loaded && launchctl bootout "$DOMAIN/$LABEL" || true; rm -f "$PLIST"; echo "Removed. Settings in $ENV_FILE and the log are left in place." ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
