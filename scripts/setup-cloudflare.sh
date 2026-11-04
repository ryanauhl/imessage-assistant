#!/usr/bin/env bash
# Exposes the local server through a Cloudflare Tunnel, protected by Cloudflare Access.
# usage: scripts/setup-cloudflare.sh messages.example.com
set -euo pipefail
HOSTNAME_="${1:?usage: $0 <public hostname on a zone in your Cloudflare account>}"
PORT="${PORT:-3777}"
TUNNEL="imessage-assistant"
command -v cloudflared >/dev/null || brew install cloudflared
[ -f "$HOME/.cloudflared/cert.pem" ] || cloudflared tunnel login
cloudflared tunnel list | grep -q " $TUNNEL " || cloudflared tunnel create "$TUNNEL"
ID="$(cloudflared tunnel list -o json | python3 -c "import json,sys; print([t['id'] for t in json.load(sys.stdin) if t['name']=='$TUNNEL'][0])")"
mkdir -p "$HOME/.cloudflared"
cat > "$HOME/.cloudflared/config.yml" <<Y
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: $HOSTNAME_
    service: http://127.0.0.1:$PORT
  - service: http_status:404
Y
cloudflared tunnel route dns "$TUNNEL" "$HOSTNAME_" || true
echo "Installing cloudflared as a system service (needs sudo)…"
sudo cloudflared service install || true
cat <<M

✅ Tunnel '$TUNNEL' → https://$HOSTNAME_ → http://127.0.0.1:$PORT

Now lock it down with Cloudflare Access (Zero Trust dashboard → Access → Applications):
  1. Add a Self-hosted application for $HOSTNAME_
  2. Policy: Allow → Emails → your email(s)
  3. Copy the "Application Audience (AUD) Tag" from the app's Overview
  4. In .env set:
       AUTH_MODE=cloudflare
       CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
       CF_ACCESS_AUD=<aud tag>
       CF_ACCESS_ALLOWED_EMAILS=you@example.com
  5. Restart: launchctl kickstart -k gui/\$(id -u)/com.imessage-assistant.server
The server rejects any request whose Access JWT does not verify, so the tunnel is useless without Access.
M
