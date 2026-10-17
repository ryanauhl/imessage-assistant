/**
 * Diagnostics: run from a Terminal that you want to grant permissions from.
 *   npm run doctor
 */
import { execSync } from 'node:child_process';
import { config } from './config.js';
import { dbReadable, getDb } from './db.js';
import { listChats } from './queries.js';
import { pingMessagesApp } from './sender.js';
import * as papi from './privateapi.js';

const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => console.log(`❌ ${m}`);
const info = (m: string) => console.log(`ℹ️  ${m}`);

console.log(`node: ${process.execPath}`);
console.log(`chat.db: ${config.chatDb}`);
console.log(`auth mode: ${config.authMode}`);

if (dbReadable()) {
  ok('chat.db readable (Full Disk Access granted)');
  try {
    const chats = listChats(5);
    ok(`found ${chats.length} recent chat(s); e.g. ${chats.map((c) => c.displayName ?? c.identifier).join(', ')}`);
    const v = getDb().prepare('PRAGMA user_version').get() as { user_version: number };
    info(`chat.db user_version=${v.user_version}`);
  } catch (e) {
    bad(`query failed: ${(e as Error).message}`);
  }
} else {
  bad(`cannot read chat.db. Grant Full Disk Access to: ${process.execPath}`);
  info('System Settings → Privacy & Security → Full Disk Access → + → press ⌘⇧G and paste the path above.');
  info('If you run the launchd agent, the SAME node binary path must be the one in the plist.');
}

try {
  const name = await pingMessagesApp();
  ok(`Messages.app automation works (app name: ${name})`);
} catch (e) {
  bad(`Messages.app automation failed: ${(e as Error).message}`);
}

if (papi.privateApiEnabled()) {
  if (await papi.ping()) ok(`BlueBubbles Private API reachable at ${config.bluebubbles.url}`);
  else bad(`BlueBubbles configured but not reachable at ${config.bluebubbles.url}`);
} else {
  info('Private API not configured: tapbacks, reply-in-thread, mark-as-read and new groups are disabled.');
}

try {
  const st = execSync('tailscale status --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(st) as { Self?: { DNSName?: string }; MagicDNSSuffix?: string };
  if (j.Self?.DNSName) ok(`tailscale up as ${j.Self.DNSName.replace(/\.$/, '')}`);
} catch {
  info('tailscale not running / not installed');
}
process.exit(0);
