import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Minimal .env loader (no dependency). Does not override existing env vars. */
function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      // strip trailing inline comment:  KEY=value   # note
      val = val.replace(/\s+#.*$/, '').trim();
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const envFile = process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env');
loadEnvFile(envFile);

const csv = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export type AuthMode = 'tailscale' | 'cloudflare' | 'token' | 'none';

const home = os.homedir();

export const config = {
  port: Number(process.env.PORT ?? 3777),
  /** Always bind loopback unless explicitly overridden; Tailscale/Cloudflare proxy into it. */
  host: process.env.HOST ?? '127.0.0.1',
  authMode: (process.env.AUTH_MODE ?? 'tailscale') as AuthMode,
  /** Optional extra shared secret required on top of the identity provider. */
  appToken: process.env.APP_TOKEN ?? '',
  tailscale: {
    allowedLogins: csv(process.env.TAILSCALE_ALLOWED_LOGINS),
  },
  cloudflare: {
    teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN ?? '', // e.g. myteam.cloudflareaccess.com
    aud: process.env.CF_ACCESS_AUD ?? '',
    allowedEmails: csv(process.env.CF_ACCESS_ALLOWED_EMAILS),
  },
  chatDb: process.env.CHAT_DB ?? path.join(home, 'Library/Messages/chat.db'),
  attachmentsRoot: path.join(home, 'Library/Messages/Attachments'),
  addressBookDir: path.join(home, 'Library/Application Support/AddressBook'),
  dataDir: process.env.DATA_DIR ?? path.join(home, 'Library/Application Support/imessage-assistant'),
  pollMs: Number(process.env.POLL_MS ?? 1000),
  /**
   * How to mark conversations read:
   *   auto        Private API if configured, else Messages.app UI automation
   *   private-api only the Private API
   *   ui          only UI automation (clicks the chat in Messages; steals focus on the Mac)
   *   off         disabled
   */
  markReadMethod: (process.env.MARK_READ_METHOD ?? 'auto') as 'auto' | 'private-api' | 'ui' | 'off',
  /**
   * Where outgoing attachments are staged for the Messages stack to read.
   *
   * Messages.app is sandboxed AND the upload is performed by a separate helper (IMTransferAgent),
   * so the file must be readable by both. Verified on macOS 27:
   *   ~/Library/Application Support/<app>/  -> no attachment row at all, empty message sent
   *   ~/Downloads/<dir>/                    -> no attachment row (TCC blocks Messages)
   *   /private/var/tmp/com.apple.messages/  -> row created, transfer fails (state 6, error 34)
   *   ~/Library/Messages/<dir>/             -> works (state 5, error 0, file copied into the store)
   * Only change this if you know the whole Messages stack can read the new path.
   */
  uploadStagingDir: process.env.UPLOAD_STAGING_DIR ?? path.join(home, 'Library/Messages/imessage-assistant-outbox'),
  bluebubbles: {
    url: (process.env.BLUEBUBBLES_URL ?? '').replace(/\/+$/, ''),
    password: process.env.BLUEBUBBLES_PASSWORD ?? '',
  },
  webDist: process.env.WEB_DIST ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web/dist'),
};

export const dirs = {
  outbox: config.uploadStagingDir,
  cache: path.join(config.dataDir, 'cache'),
  logs: path.join(config.dataDir, 'logs'),
};

export function ensureDirs() {
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
}
