import fs from 'node:fs';
import path from 'node:path';
import webpush, { type PushSubscription } from 'web-push';
import { config } from './config.js';

/**
 * Web Push so installed PWAs get notifications even when no window is open.
 * Payloads are end-to-end encrypted per RFC 8291; the browser's push service only relays.
 * VAPID keys and subscriptions are persisted in DATA_DIR.
 */
const keysFile = () => path.join(config.dataDir, 'vapid.json');
const subsFile = () => path.join(config.dataDir, 'push-subscriptions.json');

interface StoredSub {
  sub: PushSubscription;
  login: string;
  createdAt: number;
}

let keys: { publicKey: string; privateKey: string } | null = null;
let subs: StoredSub[] = [];

export function initPush() {
  if (fs.existsSync(keysFile())) {
    keys = JSON.parse(fs.readFileSync(keysFile(), 'utf8'));
  } else {
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(keysFile(), JSON.stringify(keys, null, 2), { mode: 0o600 });
  }
  webpush.setVapidDetails('mailto:admin@localhost', keys!.publicKey, keys!.privateKey);
  try {
    subs = JSON.parse(fs.readFileSync(subsFile(), 'utf8'));
  } catch {
    subs = [];
  }
}

function save() {
  fs.writeFileSync(subsFile(), JSON.stringify(subs, null, 2), { mode: 0o600 });
}

export function publicKey(): string {
  return keys?.publicKey ?? '';
}

export function subscribe(sub: PushSubscription, login: string) {
  subs = subs.filter((s) => s.sub.endpoint !== sub.endpoint);
  subs.push({ sub, login, createdAt: Date.now() });
  save();
}

export function unsubscribe(endpoint: string) {
  subs = subs.filter((s) => s.sub.endpoint !== endpoint);
  save();
}

export function subscriptionCount() {
  return subs.length;
}

export interface PushPayload {
  title: string;
  body: string;
  chatId: number;
  tag: string;
  unread: number;
}

export async function broadcast(payload: PushPayload, log: (msg: string) => void) {
  if (!subs.length) return;
  const data = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.sub, data, { TTL: 60 * 60, urgency: 'high' });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.sub.endpoint);
        else log(`push failed (${code ?? 'n/a'}): ${(e as Error).message}`);
      }
    }),
  );
  if (dead.length) {
    subs = subs.filter((s) => !dead.includes(s.sub.endpoint));
    save();
  }
}
