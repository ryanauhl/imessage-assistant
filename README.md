# imessage-assistant

A self-hosted web client for iMessage / SMS / RCS that runs on your Mac and is reachable from any
device on your Tailscale tailnet (or through Cloudflare Access). The Mac does all the work because
Apple only lets the signed-in Messages.app send messages; the server binds to `127.0.0.1` only and
is exposed exclusively through Tailscale Serve or a Cloudflare Tunnel.

## What works

| Feature | How | Notes |
|---|---|---|
| Read all conversations, groups, unread counts, read/delivered receipts | reads `~/Library/Messages/chat.db` (read-only) | needs Full Disk Access |
| Live updates | watches chat.db WAL, pushes over WebSocket | ~1 s latency |
| Send text to any existing iMessage / SMS / RCS chat (1:1 and group) | AppleScript → Messages.app | |
| Send files / images (drag, pick, paste) | AppleScript → Messages.app | |
| Start a new 1:1 conversation (iMessage or SMS) | AppleScript | SMS needs Text Message Forwarding |
| View attachments (HEIC auto-converted), videos, audio | served from Attachments dir | |
| Tapbacks shown on messages, reply-in-thread quotes, thread view | from chat.db | |
| Contact names | reads local AddressBook stores | same FDA grant |
| Search | `message.text` LIKE | |
| Pin conversations | stored in the browser | Pinned section at top of the list |
| Install as an app (PWA) + push notifications + unread badge | manifest + service worker + Web Push | see below |
| Mark 1:1 chats read when you open/reply here (syncs to iPhone) | focuses the chat in Messages.app | Mac must be unlocked; see Read sync |
| **Send tapbacks, reply in thread, mark groups read / mark unread, create groups, rename / add / remove** | **Private API via BlueBubbles helper (optional)** | Apple has no public API for these; see below |

Without the Private API those buttons are shown disabled with an explanation; everything else works.

## Install (5 minutes)

```bash
cd ~/dev/imessage-assistant
npm install
npm run build
cp .env.example .env     # edit AUTH_MODE / allowed logins
npm run doctor           # checks FDA, Messages automation, Private API, tailscale
```

### 1. Permissions (one-time)

`npm run doctor` prints the exact node path. Then:

1. **Full Disk Access** — System Settings → Privacy & Security → Full Disk Access → `+` → press `⌘⇧G`,
   paste the node path → enable. (For the launchd service this is `~/Library/Application Support/imessage-assistant/bin/node`,
   a private copy so Homebrew upgrades don't revoke the grant.)
2. **Automation** — the first send triggers "node wants to control Messages". Click Allow. If it was denied,
   fix it in System Settings → Privacy & Security → Automation.
3. Keep the Mac awake: System Settings → Energy → *Prevent automatic sleeping when the display is off*.
   Messages.app must stay signed in (it doesn't need to be open; AppleScript launches it).

### 2. Run as a service (isolated, auto-restart, starts at login)

```bash
scripts/install-service.sh        # launchd agent com.ryanauhl.imessage-assistant
scripts/uninstall-service.sh      # remove
```

Logs: `~/Library/Application Support/imessage-assistant/logs/`. Restart after `.env` changes:
`launchctl kickstart -k gui/$(id -u)/com.ryanauhl.imessage-assistant`.

Nothing else on the Mac is touched: the app lives in the repo + its own data dir, listens on loopback,
and only reads chat.db. Staged uploads live in the data dir `outbox/` and are pruned after 24 h.

### 3a. Expose via Tailscale (recommended)

```bash
scripts/setup-tailscale.sh        # tailscale serve --bg --https=443 http://127.0.0.1:3777
```

Open `https://<mac-name>.<tailnet>.ts.net/` from any tailnet device. Tailscale terminates TLS and
injects `Tailscale-User-Login`; the server only trusts that header on loopback connections and only
for `TAILSCALE_ALLOWED_LOGINS`. Prereq: enable **HTTPS Certificates** and MagicDNS in the Tailscale admin → DNS.

### 3b. Expose via Cloudflare Access (alternative)

```bash
scripts/setup-cloudflare.sh messages.yourdomain.com
```

Creates a named tunnel, routes DNS, installs cloudflared as a service, and prints the Access app steps.
Set `AUTH_MODE=cloudflare`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_ALLOWED_EMAILS`. Every request
must carry a valid Access JWT (verified against Cloudflare's JWKS, audience-checked) or it gets 401.

### Optional second factor

Set `APP_TOKEN` (any mode) and the UI asks for it once per browser (cookie, 90 days). Required when
`AUTH_MODE=token`. Generate with `openssl rand -hex 24`.

## Install as an app and get notifications (PWA)

On Windows/macOS Chrome or Edge, open the Tailscale URL and use the install icon in the address bar
(or menu → *Install Messages*). It opens in its own window and gets a taskbar/dock icon with an
unread badge. Then click **enable notifications** in the bottom-left of the app. That registers this
device for Web Push, so new messages notify you even when the window is closed; clicking the
notification opens that conversation.

Push payloads are end-to-end encrypted (RFC 8291); the browser's push relay only sees ciphertext.
VAPID keys are generated on first run and stored in the data dir together with the subscriptions.
Safari on macOS supports this too once installed to the Dock. A secure origin (HTTPS) is required,
which Tailscale Serve and Cloudflare both provide.

## Read sync

Opening a conversation here, or replying in it, marks it read on the Mac, which syncs the read
state to your iPhone and iPad. Without the Private API this works by bringing that conversation to
the front in Messages.app (`imessage:` URL + activate), which is what makes macOS mark it read.
Consequences: Messages.app takes focus on the Mac, the Mac must be unlocked, and it only works for
1:1 chats. The app tells you if the read state didn't flip. Set `MARK_READ_FALLBACK=off` to disable,
or configure the Private API for silent read/unread on any chat including groups.

## Tapbacks, reply-in-thread, mark-as-read (Private API)

Apple provides no public API for these; AppleScript can only send text/files. The working approach is
BlueBubbles' Private API helper, which injects into Messages.app (requires SIP partially disabled —
read their docs and decide if that's acceptable for you):
https://docs.bluebubbles.app/private-api/installation

Once BlueBubbles Server runs on this Mac with Private API enabled, add to `.env`:

```
BLUEBUBBLES_URL=http://127.0.0.1:1234
BLUEBUBBLES_PASSWORD=<its server password>
```

The capabilities flip on automatically (`GET /api/me` → `capabilities`). You don't need to use the
BlueBubbles client; this app just calls its local REST API for those operations.

## Development

```bash
npm run dev          # server (tsx watch, :3777) + vite (:5173, proxies /api)
npm run typecheck
npm test
node scripts/make-fixture.mjs /tmp/fixture-chat.db   # fake chat.db for UI work
CHAT_DB=/tmp/fixture-chat.db AUTH_MODE=none npm start
```

Layout: `server/` (Fastify + `node:sqlite`, no native modules), `web/` (Vite + React), `scripts/`.
Key files: `server/src/queries.ts` (chat.db schema mapping), `server/src/sender.ts` (AppleScript),
`server/src/privateapi.ts` (BlueBubbles adapter), `server/src/auth.ts`.

## Troubleshooting

- **503 / "Cannot read chat.db"** — Full Disk Access not granted to the exact node binary the service runs.
  `npm run doctor` tells you which path.
- **"not allowed to send Apple events"** — Automation permission denied; see Permissions.
- **Sent message doesn't appear** — Messages.app may need the chat opened once; check `server.err.log`.
- **Attachment "(not available)"** — the file isn't downloaded on this Mac yet; open it in Messages.app once.
- **New group chat** — needs Private API; otherwise start the group from iPhone/Mac and it appears here.
- **Tailscale 401** — `TAILSCALE_ALLOWED_LOGINS` must match the login shown by `tailscale status`.
