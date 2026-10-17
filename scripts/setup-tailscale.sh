#!/usr/bin/env bash
# Exposes the local server on your tailnet over HTTPS using Tailscale Serve.
# Only devices on your tailnet can reach it; identity headers are injected by tailscaled.
# Prereq: enable HTTPS certificates + MagicDNS in https://login.tailscale.com/admin/dns
set -euo pipefail
PORT="${PORT:-3777}"
tailscale status >/dev/null || { echo "tailscale is not running / not logged in"; exit 1; }
tailscale serve --bg --https=443 "http://127.0.0.1:${PORT}"
HOST="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
echo
echo "✅ https://${HOST}/"
echo "   Set AUTH_MODE=tailscale and TAILSCALE_ALLOWED_LOGINS=<your tailscale login> in .env"
echo "   To remove: tailscale serve reset"
