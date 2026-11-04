# imessage-assistant

Read and send your iMessage, SMS and RCS conversations from any device, served from your own Mac.

The Mac does the work, because only the signed-in Messages.app can actually send. A small Node
service reads the local Messages database, drives Messages.app for sending, and serves a web app.
It binds to loopback only and is reachable exclusively over your Tailscale tailnet or a Cloudflare
Access tunnel. Nothing is sent to a third party, and there is no hosted component.

> ### Status: personal project
>
> I built this for myself, in my own home, against my own Mac. It is shared in case it is useful or
> interesting, **not** as a product.
>
> - **No guarantee of maintenance.** I may never fix an issue or merge a pull request.
> - **No support.** Issues may go unanswered. Please do not expect a response.
> - **No stability promises.** It leans on undocumented Messages behaviour and Apple can break it
>   with any macOS update. Several parts already work only on specific macOS versions.
> - **Use at your own risk.** It touches your private messages and automates your Mac. Read the
>   permissions section before installing, and read the code if you are at all unsure.
>
> Forks are welcome and probably wiser than waiting on me. See [Licence](#licence).

## Requirements

- A Mac signed in to iMessage that stays awake, ideally one you are not using for anything else.
  A headless Mac mini is the intended shape.
- macOS 26 or later. Developed and tested against macOS 27.
- Node 24 or later, for the built-in `node:sqlite` module. No native build step.
- Tailscale, or a Cloudflare account with a domain, to reach it from elsewhere.

## What works

| Feature | How | Notes |
|---|---|---|
| Read all conversations, groups, unread counts, read/delivered receipts | reads `~/Library/Messages/chat.db` (read-only) | needs Full Disk Access |
| Correct iMessage / SMS / RCS labels | derived from recent messages, not `chat.service_name` | the chat row records handle capability, not the thread |
| Live updates | watches the chat.db WAL, pushes over WebSocket | about one second |
| Send text to an existing chat, one-to-one or group | AppleScript to Messages.app | RCS routing for one-to-one only, see below |
| Send files, images, drag, paste | AppleScript to Messages.app | staging path matters, see below |
| Start a new one-to-one conversation | AppleScript | SMS needs Text Message Forwarding |
| View attachments, HEIC converted, video, audio | served from the Attachments directory | |
| Tapbacks, reply quoting, thread view | read from chat.db | sending them needs the Private API |
| Contact names and search | local AddressBook stores | same Full Disk Access grant |
| Pin conversations, resizable list, keyboard shortcuts | stored per browser | Ctrl+N, Ctrl+F, Ctrl+[ / Ctrl+], Esc |
| Install as an app, push notifications, unread badge | PWA with Web Push | works on Windows, macOS, iOS |
| Mark one-to-one chats read, syncing to your phone | Accessibility automation of Messages.app | a permission grant, not a SIP change |

### Known limitations

These are real and unlikely to change without the Private API:

- **Sending tapbacks and replying in a thread** is not possible through AppleScript. Reading them is.
- **Group chats that moved from iMessage to RCS** still send as iMessage. The app detects this and
  refuses rather than sending on the wrong transport. See [Groups](#groups).
- **Marking read** works for one-to-one chats only, and brings Messages.app to the front each time.
- **Marking unread**, creating group chats, and renaming or changing members all need the Private API.
- Everything depends on the Mac being awake, unlocked and signed in to iMessage.

## Security and privacy

- Your messages never leave your machine. There is no server component anywhere else.
- The service binds to `127.0.0.1` and is never exposed on your LAN.
- Over Tailscale, identity comes from the headers `tailscale serve` injects, trusted only on loopback
  and only for logins you allow-list. Over Cloudflare, every request must carry a valid Access JWT
  verified against Cloudflare's JWKS.
- An optional `APP_TOKEN` adds a shared secret on top of either.
- It needs Full Disk Access to read the Messages database, Automation to drive Messages.app, and
  optionally Accessibility to mark chats read. Those are broad permissions. Granting them to any
  program, including this one, deserves a look at the source first.

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
scripts/install-service.sh        # launchd agent com.imessage-assistant.server
scripts/uninstall-service.sh      # remove
```

Logs: `~/Library/Application Support/imessage-assistant/logs/`. Restart after `.env` changes:
`launchctl kickstart -k gui/$(id -u)/com.imessage-assistant.server`.

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

## Sending to RCS conversations

When a contact moves from iPhone to Android their thread becomes RCS, but `chat id <guid>` in
AppleScript always resolves to the **iMessage** account, so replies kept going out as iMessage.
Verified on macOS 27 against a thread whose recent messages were all RCS:

| Addressing | Resolves to |
|---|---|
| `chat id "any;-;+1555…"` | iMessage account |
| `participant "+1555…" of <RCS account>` | RCS account |
| `chat id "any;-;+1555…" of <RCS account>` | fails |

So one-to-one chats are now sent by addressing the participant under the account matching the
conversation's current service, taken from the newest message in the thread. iMessage threads are
unaffected and still use the chat reference.

### Groups

Groups have no participant form, so the only handle is the chat object, and which account that
object belongs to is decided by Messages, not by us:

| Group | `chat id <guid>` resolves to | Sends correctly? |
|---|---|---|
| Only ever RCS | RCS account | yes |
| Long iMessage history, now RCS | iMessage account | no |

A group that has always been RCS resolves to the RCS account and sends fine with no special
handling. A group that ran on iMessage for years and has since moved to RCS stays registered under
the iMessage account, and there is no way to reach the other instance: service-prefixed GUIDs
(`RCS;+;<id>`) do not resolve, and the group is absent from the RCS and SMS accounts' chat lists.

Messages re-binds this on its own: the same thread can sit under the iMessage account, flip to RCS,
and flip back, which is why the behaviour looks intermittent. The Mac's own Messages window sends
on whatever the current binding is, so a blue bubble there is not an app limitation.

Rather than quietly send on the wrong transport, the server resolves the binding at send time and
returns **409 `service_mismatch`** when the conversation is RCS or SMS but the chat resolves to
iMessage. The web app surfaces the reason and offers to send as iMessage anyway. The lookup is
cached for only fifteen seconds, enough to coalesce a burst of sends without going stale while the
binding moves. It runs only for non-iMessage groups, so ordinary sending is unaffected.

## Read sync

Opening a conversation in the web app marks it read on the Mac, which syncs the cleared badge to
your iPhone and iPad. This is independent of read receipts: with receipts off, marking read never
notifies the sender, it only syncs your own unread state.

Apple exposes no API for this, so the server drives Messages.app through the Accessibility API. It
navigates to the conversation with the `imessage:` URL and then invokes **Conversation > Mark as
Read** from the menu bar. Measured on macOS 27:

| Approach | Result |
|---|---|
| `imessage:` URL alone | unread unchanged, even with Messages frontmost |
| Clicking the conversation in the sidebar | works, but the sidebar is hidden in a narrow window |
| **URL navigation + Mark as Read menu item** | **works, and does not depend on window layout** |

Setup: add the server's node binary to System Settings > Privacy & Security > Accessibility.

```
~/Library/Application Support/imessage-assistant/bin/node
```

The service must be restarted afterwards, since the permission is read at process start:
`launchctl kickstart -k gui/$(id -u)/com.imessage-assistant.server`.

Caveats worth knowing before you enable it:

- Messages.app is brought to the front on the Mac each time a conversation is marked read.
- **Group chats are not supported.** The `imessage:` URL has no group form, so the fallback has to
  find the conversation in the sidebar, which is hidden whenever the Messages window is narrow.
  Group chats return a clear error rather than marking the wrong conversation read.
- Marking a conversation *unread* still requires the Private API.
- Set `MARK_READ_METHOD=off` to disable, or `private-api` to require the Private API instead.

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

## Licence

MIT. See [LICENSE](LICENSE). You are free to use, modify, fork, redistribute and sell this, with or
without changes. The only conditions are that the copyright notice travels with it, and that you
accept it comes with **no warranty of any kind**. Given what it touches, that disclaimer is the part
that matters most.

## Not affiliated with Apple

This is an independent project with no connection to Apple Inc. iMessage, Messages and macOS are
trademarks of Apple Inc. It relies on undocumented behaviour of Messages.app and local file formats
that Apple is free to change at any time.
