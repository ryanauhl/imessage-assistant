#!/usr/bin/env bash
# Update and restart the running service.
#
#   scripts/deploy.sh              pull, install, build, restart, verify
#   scripts/deploy.sh --no-pull    same but skip the git pull (use after local edits)
#
# Needed because server/dist and web/dist are gitignored: `git pull` alone leaves the
# service running the previously compiled code.
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="${SERVICE_LABEL:-com.imessage-assistant.server}"
# Installs made before the label was genericised still use the old one.
LEGACY_LABEL="com.ryanauhl.imessage-assistant"
if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
   && launchctl print "gui/$(id -u)/$LEGACY_LABEL" >/dev/null 2>&1; then
  LABEL="$LEGACY_LABEL"
fi
DATA_DIR="${DATA_DIR:-$HOME/Library/Application Support/imessage-assistant}"

if [ ! -f .env ]; then
  echo "No .env in $(pwd) — run this from the production clone (see README)." >&2
  exit 1
fi
PORT="$(sed -nE 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' .env | head -1)"
PORT="${PORT:-3777}"

if [ "${1:-}" != "--no-pull" ]; then
  echo "==> git pull"
  git pull --ff-only
fi

echo "==> npm install"
npm install --no-fund --no-audit --silent

echo "==> build"
npm run build --silent

echo "==> restart service"
if ! launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null; then
  echo "Service not installed yet; run scripts/install-service.sh first." >&2
  exit 1
fi

echo -n "==> waiting for health on :$PORT "
for _ in $(seq 1 30); do
  if health="$(curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null)"; then
    echo
    echo "✅ $health"
    echo "   running $(git log --oneline -1)"
    exit 0
  fi
  echo -n "."
  sleep 0.5
done

echo
echo "⚠️  Service did not become healthy. Last errors:" >&2
tail -20 "$DATA_DIR/logs/server.err.log" >&2 || true
exit 1
