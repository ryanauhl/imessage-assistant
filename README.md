# imessage-assistant

A self-hosted web client for iMessage / SMS / RCS that runs on your Mac and is reachable from any
device on your Tailscale tailnet (or through Cloudflare Access). The Mac does all the work because
Apple only lets the signed-in Messages.app send messages; the server binds to `127.0.0.1` only and
is exposed exclusively through Tailscale Serve or a Cloudflare Tunnel.

## What works

| Feature | How | Notes |
|---|---|---|
| Read all conversations, groups, unread counts, read/delivered receipts | reads `~/Library/Messages/chat.db` (read-only) | needs Full Disk Access |
| Correct iMessage / SMS / RCS labels | derived from recent messages, not `chat.service_name` | the chat row records handle capability, not the thread |
| Live updates | watches chat.db WAL, pushes over WebSocket | ~1 s latency |
| Send text to any existing iMessage / SMS / RCS chat (1:1 and group) | AppleScript → Messages.app | |
| Send files / images (drag, pick, paste) | AppleScript → Messages.app | |
| Start a new 1:1 conversation (iMessage or SMS) | AppleScript | SMS needs Text Message Forwarding |
| View attachments (HEIC auto-converted), videos, audio | served from Attachments dir | |
| Tapbacks shown on messages, reply-in-thread quotes, thread view | from chat.db | |
| Contact names | reads local AddressBook stores | same FDA grant |
| Search | `message.text` LIKE | |
| Pin conversations | stored in the browser | Pinned section at top of the list |
| Resizable conversation list | drag the divider, double-click to reset | width saved per browser |
| Keyboard shortcuts | Ctrl+N new, Ctrl+F search, Ctrl+[ / Ctrl+] previous/next chat | ⌘ also works on macOS |
| Install as an app (PWA) + push notifications + unread badge | manifest + service worker + Web Push | see below |
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

**Updating:** `scripts/deploy.sh` pulls, installs, builds, restarts the service and waits for the
health check, printing the commit it ended up on. `git pull` on its own is never enough — `server/dist`
and `web/dist` are gitignored, so the service keeps running the previously compiled code until you
rebuild. Use `scripts/deploy.sh --no-pull` to rebuild and restart after local edits.

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

## Attachments (important)

Messages.app is sandboxed, and the upload is performed by a separate helper process, so a staged
file must be readable by **both**. Get this wrong and the failure is silent: Messages shows a file
bubble on the Mac while nothing reaches the recipient. Measured on macOS 27 with the same image:

| Staging location | Result |
|---|---|
| `~/Library/Application Support/<app>/` | no attachment row at all, empty message delivered |
| `~/Downloads/<dir>/` | no attachment row (TCC blocks Messages from reading it) |
| `/private/var/tmp/com.apple.messages/<dir>/` | row created, transfer fails (state 6, error 34) |
| **`~/Library/Messages/<dir>/`** | **works** — state 5, error 0, file copied into the Messages store |

Outgoing files are therefore staged in `~/Library/Messages/imessage-assistant-outbox/`. Override
with `UPLOAD_STAGING_DIR` only if you verify attachments still arrive.

Each upload goes in its own subdirectory so the original filename is preserved, and the server
confirms the attachment rows actually landed before reporting success. If they don't, you get an
error instead of a message that looks sent but isn't. Staged files are pruned after 6 hours.

## Read sync is not available without the Private API

Apple exposes no public way to mark a conversation read. Opening it with the `imessage:` URL scheme
does **not** flip the read state (verified on macOS 27: the unread count was unchanged with Messages
frontmost and the conversation open). Marking read — and therefore clearing the unread badge on your
iPhone and iPad — only works with the Private API below. This is independent of read receipts: with
read receipts off, marking a chat read never notifies the sender, it only syncs your own unread
state across your devices.

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
