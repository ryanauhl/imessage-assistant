#!/usr/bin/env bash
# Installs imessage-assistant as a per-user launchd agent (starts at login, restarts on crash).
# Copies the node binary to a stable path so Full Disk Access survives Homebrew upgrades.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.ryanauhl.imessage-assistant"
DATA_DIR="${DATA_DIR:-$HOME/Library/Application Support/imessage-assistant}"
BIN_DIR="$DATA_DIR/bin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[ -f "$REPO/.env" ] || { echo "Create $REPO/.env first (copy .env.example)"; exit 1; }
[ -f "$REPO/server/dist/index.js" ] || { echo "Run 'npm run build' first"; exit 1; }

mkdir -p "$BIN_DIR" "$DATA_DIR/logs" "$HOME/Library/LaunchAgents"
SRC_NODE="$(readlink -f "$(command -v node)")"
cp -f "$SRC_NODE" "$BIN_DIR/node"
chmod +x "$BIN_DIR/node"
echo "node copied to $BIN_DIR/node (grant Full Disk Access to THIS path)"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$BIN_DIR/node</string>
    <string>$REPO/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict>
    <key>ENV_FILE</key><string>$REPO/.env</string>
    <key>DATA_DIR</key><string>$DATA_DIR</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$DATA_DIR/logs/server.log</string>
  <key>StandardErrorPath</key><string>$DATA_DIR/logs/server.err.log</string>
</dict></plist>
PL

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
sleep 2
if curl -fsS "http://127.0.0.1:${PORT:-3777}/healthz"; then
  echo; echo "✅ service running. Logs: $DATA_DIR/logs/"
else
  echo "⚠️  not responding yet; check $DATA_DIR/logs/server.err.log"
fi
echo
echo "Next: System Settings → Privacy & Security → Full Disk Access → add:"
echo "   $BIN_DIR/node"
echo "then: launchctl kickstart -k gui/$(id -u)/$LABEL"
