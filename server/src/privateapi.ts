import { config } from './config.js';
import type { ReactionName } from './types.js';

/**
 * Optional adapter for features Apple exposes no public API for: tapbacks, reply-in-thread,
 * mark-as-read, group management. Backed by a BlueBubbles server running on this Mac with its
 * Private API helper enabled (https://docs.bluebubbles.app/private-api/installation).
 */
export function privateApiEnabled(): boolean {
  return Boolean(config.bluebubbles.url && config.bluebubbles.password);
}

async function call<T = unknown>(method: 'GET' | 'POST' | 'DELETE' | 'PUT', endpoint: string, body?: unknown): Promise<T> {
  if (!privateApiEnabled()) throw new Error('Private API not configured (BLUEBUBBLES_URL / BLUEBUBBLES_PASSWORD)');
  const url = new URL(config.bluebubbles.url + endpoint);
  url.searchParams.set('password', config.bluebubbles.password);
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: number; message?: string; error?: { message?: string }; data?: T };
  if (!res.ok) throw new Error(json.error?.message || json.message || `BlueBubbles ${res.status}`);
  return json.data as T;
}

export async function ping(): Promise<boolean> {
  try {
    await call('GET', '/api/v1/ping');
    return true;
  } catch {
    return false;
  }
}

export async function react(chatGuid: string, messageGuid: string, reaction: ReactionName, remove: boolean, partIndex = 0) {
  if (reaction === 'custom') throw new Error('Custom emoji tapbacks are not supported');
  return call('POST', '/api/v1/message/react', {
    chatGuid,
    selectedMessageGuid: messageGuid,
    reaction: remove ? `-${reaction}` : reaction,
    partIndex,
  });
}

export async function replyInThread(chatGuid: string, text: string, replyToGuid: string, partIndex = 0) {
  return call('POST', '/api/v1/message/text', {
    chatGuid,
    message: text,
    method: 'private-api',
    selectedMessageGuid: replyToGuid,
    partIndex,
    tempGuid: `temp-${Date.now()}`,
  });
}

export async function markRead(chatGuid: string) {
  return call('POST', `/api/v1/chat/${encodeURIComponent(chatGuid)}/read`);
}

export async function markUnread(chatGuid: string) {
  return call('POST', `/api/v1/chat/${encodeURIComponent(chatGuid)}/unread`);
}

export async function createGroup(addresses: string[], message: string, service: 'iMessage' | 'SMS' = 'iMessage') {
  return call('POST', '/api/v1/chat/new', { addresses, message, service, method: 'private-api' });
}

export async function renameGroup(chatGuid: string, name: string) {
  return call('PUT', `/api/v1/chat/${encodeURIComponent(chatGuid)}`, { displayName: name });
}

export async function addParticipant(chatGuid: string, address: string) {
  return call('POST', `/api/v1/chat/${encodeURIComponent(chatGuid)}/participant`, { address });
}

export async function removeParticipant(chatGuid: string, address: string) {
  return call('DELETE', `/api/v1/chat/${encodeURIComponent(chatGuid)}/participant`, { address });
}

export async function sendTyping(chatGuid: string, typing: boolean) {
  return call(typing ? 'POST' : 'DELETE', `/api/v1/chat/${encodeURIComponent(chatGuid)}/typing`);
}
