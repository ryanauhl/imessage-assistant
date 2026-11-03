import type { ChatSummary, Message, ReactionName } from '@shared/types';

export interface Me {
  identity: { provider: string; login: string; name?: string };
  capabilities: { send: boolean; files: boolean; newChat: boolean; privateApi: boolean; tapback: boolean; replyInThread: boolean; markRead: boolean; markReadMethod: 'private-api' | 'ui-automation' | 'off'; markUnread: boolean; groupManage: boolean };
  dbReadable: boolean;
  totalUnread: number;
}

export interface ContactHit {
  name: string;
  address: string;
  kind: 'phone' | 'email';
  source: 'contacts' | 'recent';
  service?: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    let body: { error?: string; message?: string; reason?: string; needToken?: boolean } = {};
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, body.message || body.error || body.reason || res.statusText, body);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  me: () => req<Me>('/me'),
  login: (token: string) => req<{ ok: true }>('/login', json({ token })),
  chats: () => req<ChatSummary[]>('/chats'),
  chat: (id: number) => req<ChatSummary>(`/chats/${id}`),
  messages: (id: number, before?: number) => req<Message[]>(`/chats/${id}/messages?limit=60${before ? `&before=${before}` : ''}`),
  thread: (guid: string) => req<Message[]>(`/threads/${encodeURIComponent(guid)}`),
  search: (q: string) => req<Message[]>(`/search?q=${encodeURIComponent(q)}`),
  send: (id: number, text: string, replyToGuid?: string) => req<{ ok: true }>(`/chats/${id}/send`, json({ text, replyToGuid })),
  sendFiles: (id: number, files: File[], text?: string) => {
    const fd = new FormData();
    if (text) fd.append('text', text);
    for (const f of files) fd.append('file', f, f.name);
    return req<{ ok: true }>(`/chats/${id}/files`, { method: 'POST', body: fd });
  },
  newMessage: (addresses: string[], service: 'iMessage' | 'SMS' | 'RCS', text: string) => req<{ ok: true; chatId?: number }>('/messages/new', json({ addresses, service, text })),
  contactSearch: (q: string) => req<ContactHit[]>(`/contacts/search?q=${encodeURIComponent(q)}`),
  react: (id: number, messageGuid: string, reaction: ReactionName, remove: boolean) => req<{ ok: true }>(`/chats/${id}/react`, json({ messageGuid, reaction, remove })),
  markRead: (id: number, unread = false) => req<{ ok: true; method: string; matched?: string; remainingUnread?: number }>(`/chats/${id}/read`, json({ unread })),
  typing: (id: number, typing: boolean) => req<{ ok: boolean }>(`/chats/${id}/typing`, json({ typing })).catch(() => undefined),
  group: (id: number, body: { name?: string; add?: string; remove?: string }) => req<{ ok: true }>(`/chats/${id}/group`, json(body)),
  pushKey: () => req<{ publicKey: string; subscriptions: number }>('/push/key'),
  pushSubscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) => req<{ ok: true }>('/push/subscribe', json({ subscription })),
  pushUnsubscribe: (endpoint: string) => req<{ ok: true }>('/push/unsubscribe', json({ endpoint })),
};

export function attachmentUrl(id: number, opts: { thumb?: boolean; download?: boolean } = {}) {
  const p = new URLSearchParams();
  if (opts.thumb) p.set('thumb', '1');
  if (opts.download) p.set('download', '1');
  const qs = p.toString();
  return `/api/attachments/${id}${qs ? `?${qs}` : ''}`;
}

export type ChangeEvent = { type: 'change'; newMessages: Message[]; chatIds: number[]; totalUnread: number } | { type: 'hello'; totalUnread: number };

export function connectWs(onEvent: (ev: ChangeEvent) => void, onStatus: (connected: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 1000;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onopen = () => {
      retry = 1000;
      onStatus(true);
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      onStatus(false);
      if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 15000)));
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
