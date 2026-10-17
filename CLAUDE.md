# imessage-assistant — project notes

- Monorepo: `server/` (Fastify 5, TypeScript, `node:sqlite` with `readBigInts` — chat.db dates overflow Number), `web/` (Vite + React 19). `web` imports server types via the `@shared/*` alias.
- Verify with `npm run typecheck && npm test && npm run build`. For a runnable server without Full Disk Access use the fixture: `node scripts/make-fixture.mjs /tmp/fixture-chat.db` then `CHAT_DB=/tmp/fixture-chat.db AUTH_MODE=none PORT=3799 npm start`.
- The server must stay bound to `127.0.0.1`; identity comes from Tailscale Serve headers (trusted only on loopback) or a Cloudflare Access JWT. Never trust those headers from non-loopback.
- Everything AppleScript can't do (tapbacks, thread replies, mark read, group management) goes through `server/src/privateapi.ts` and is gated by `privateApiEnabled()`; return 501 with a clear message when unavailable.
- Pass user text to `osascript` via argv (`on run argv`), never by string interpolation into the script.
