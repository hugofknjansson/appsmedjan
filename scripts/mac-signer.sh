#!/bin/bash
# A second macOS user on a build Mac that holds the Apple key and uploads to TestFlight.
#
# Apps in the simulator run as the macOS user of the preview worker and can read that user's files.
# Keeping the Apple key under another user, whose home the first one cannot open, is what keeps a
# generated app from reading it. This user never runs a simulator and never logs in on the screen.
#
#   sudo scripts/mac-signer.sh create-user      Create the user and let the caller's SSH keys log in as it.
#   sudo scripts/mac-signer.sh install-daemon   Start that user's worker at boot (after its code and .env are in place).
#   sudo scripts/mac-signer.sh status           Is the user there, is the daemon running?
#   sudo scripts/mac-signer.sh remove-daemon    Stop and remove the daemon (the user and its files stay).
#
# Needs root because it creates a user and a launch daemon. Run it from the administrator's account.
set -euo pipefail

NAME="${SIGNER_USER:-signer}"
LABEL="se.appsmedjan.signer"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
HOME_DIR="/Users/$NAME"
REPO="$HOME_DIR/appsmedjan"

die() { printf 'Error: %s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run this with sudo"
ADMIN="${SUDO_USER:-}"
[ -n "$ADMIN" ] && [ "$ADMIN" != "root" ] || die "run this with sudo from the administrator's own account"

cmd_create_user() {
  if id "$NAME" >/dev/null 2>&1; then
    echo "User $NAME already exists."
  else
    echo "Creating user $NAME. Choose any password: nothing here uses it afterwards."
    # '-' makes sysadminctl ask for the password, so it never appears in the process list.
    sysadminctl -addUser "$NAME" -fullName "App Dance signing" -password -
    id "$NAME" >/dev/null 2>&1 || die "the user was not created"
  fi
  createhomedir -c -u "$NAME" >/dev/null 2>&1 || true
  [ -d "$HOME_DIR" ] || die "$HOME_DIR does not exist"
  # Nobody else gets to look inside, the preview worker's user least of all.
  chmod 700 "$HOME_DIR"

  # Remote Login may be limited to a group; a standard user has to be added to it.
  if dscl . -read /Groups/com.apple.access_ssh >/dev/null 2>&1; then
    dseditgroup -o edit -a "$NAME" -t user com.apple.access_ssh
  fi
  local keys="/Users/$ADMIN/.ssh/authorized_keys"
  [ -f "$keys" ] || die "$keys not found: add your SSH key to $ADMIN first (ssh-copy-id)"
  install -d -m 700 -o "$NAME" -g staff "$HOME_DIR/.ssh"
  install -m 600 -o "$NAME" -g staff "$keys" "$HOME_DIR/.ssh/authorized_keys"
  echo "Done. Log in with: ssh $NAME@<this Mac>"
}

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>UserName</key><string>$NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/run-worker.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME_DIR</string>
    <key>USER</key><string>$NAME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>90</integer>
  <!-- A daemon normally shares the system's security session, where only the System keychain is
       searched and the user's own keychain list is ignored. A session of its own makes the signing
       keychain visible to Xcode. -->
  <key>SessionCreate</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/Library/Logs/appsmedjan-worker.log.launchd</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/Library/Logs/appsmedjan-worker.log.launchd</string>
</dict>
</plist>
EOF
}

# Stops the daemon and waits until launchd has let go of it: starting it again while the old one is
# still shutting down fails with "Bootstrap failed: 5: Input/output error".
stop_daemon() {
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  local i
  for i in $(seq 1 100); do
    launchctl print "system/$LABEL" >/dev/null 2>&1 || return 0
    sleep 1
  done
  die "the old daemon did not stop"
}

# Apple's intermediate certificates, in the System keychain. Xcode puts them in the keychain of the user
# who signs, which is enough at a desk. A daemon's signature is checked by the system's own trust
# service, which does not look there: without these, codesign stops with "unable to build chain to
# self-signed root" and errSecInternalComponent.
install_intermediates() {
  local tmp name
  tmp="$(mktemp -d)"
  for name in AppleWWDRCAG3 AppleWWDRCAG6; do
    if curl -fsSL --max-time 30 -o "$tmp/$name.cer" "https://www.apple.com/certificateauthority/$name.cer"; then
      # Fails harmlessly when the certificate is already there.
      security add-certificates -k /Library/Keychains/System.keychain "$tmp/$name.cer" 2>/dev/null || true
    else
      echo "  note     could not fetch $name.cer from apple.com; signing may fail until it is in the System keychain"
    fi
  done
  rm -rf "$tmp"
}

cmd_install_daemon() {
  id "$NAME" >/dev/null 2>&1 || die "user $NAME does not exist: run create-user first"
  [ -f "$REPO/scripts/run-worker.sh" ] || die "$REPO is not set up yet"
  [ -f "$REPO/.env" ] || die "$REPO/.env is missing"
  install_intermediates
  sudo -u "$NAME" mkdir -p "$HOME_DIR/Library/Logs"
  plist >"$PLIST"
  chown root:wheel "$PLIST"
  chmod 644 "$PLIST"
  plutil -lint "$PLIST" >/dev/null
  stop_daemon
  launchctl bootstrap system "$PLIST"
  echo "Started. Log: $HOME_DIR/Library/Logs/appsmedjan-worker.log"
}

cmd_remove_daemon() {
  stop_daemon
  rm -f "$PLIST"
  echo "Removed."
}

cmd_status() {
  if id "$NAME" >/dev/null 2>&1; then echo "  user $NAME exists"; else echo "  user $NAME does not exist"; fi
  if launchctl print "system/$LABEL" >/dev/null 2>&1; then
    launchctl print "system/$LABEL" | grep -E '^\s*(state|pid|last exit code) =' | sed 's/^[[:space:]]*/  /'
  else
    echo "  daemon not installed"
  fi
}

case "${1:-}" in
  create-user) cmd_create_user ;;
  install-daemon) cmd_install_daemon ;;
  remove-daemon) cmd_remove_daemon ;;
  status) cmd_status ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
