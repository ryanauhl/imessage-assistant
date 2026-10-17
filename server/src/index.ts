import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { config, dirs, ensureDirs } from './config.js';
import { DbUnavailableError, dbReadable } from './db.js';
import { requireAuth, sessionCookieName, sessionTokenFor } from './auth.js';
import * as q from './queries.js';
import * as sender from './sender.js';
import * as papi from './privateapi.js';
import { DbWatcher, type ChangeEvent } from './watcher.js';
import { resolveAttachmentPath, webImagePath, mimeFor } from './attachments.js';
import { allContacts, contactName } from './contacts.js';
import type { ReactionName } from './types.js';
import * as push from './push.js';
import { chatTitleFor } from './queries.js';

ensureDirs();
push.initPush();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 10 * 1024 * 1024,
  trustProxy: false,
});

await app.register(fastifyCookie);
await app.register(fastifyWebsocket);
await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024, files: 10 } });

const sockets = new Set<WebSocket>();
const watcher = new DbWatcher();
watcher.on('change', (ev: ChangeEvent) => {
  const payload = JSON.stringify(ev);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
  const recent = Date.now() - 2 * 60 * 1000;
  const inbound = ev.newMessages.filter(
    (m) => !m.fromMe && m.itemType === 0 && (m.date ?? 0) > recent && (m.text || m.attachments.length),
  );
  for (const m of inbound) {
    const title = chatTitleFor(m.chatId, m.senderName ?? m.sender ?? 'Message');
    const who = m.senderName ?? m.sender ?? '';
    const text = (m.text ?? '').replace(/\uFFFC/g, '').trim() || (m.attachments.length ? '📎 Attachment' : '');
    void push.broadcast(
      { title, body: title === who ? text : `${who}: ${text}`, chatId: m.chatId, tag: `chat-${m.chatId}`, unread: ev.totalUnread },
      (msg) => app.log.warn(msg),
    );
  }
});
watcher.on('error', (e: unknown) => app.log.warn({ err: e }, 'watcher error'));

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof DbUnavailableError) {
    reply.code(503).send({ error: 'db_unavailable', message: err.message });
    return;
  }
  const status = err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: err.name, message: err.message });
});

// ---------- Auth helpers (login page for APP_TOKEN mode) ----------
app.post<{ Body: { token?: string } }>('/api/login', async (req, reply) => {
  if (!config.appToken) return { ok: true };
  const token = req.body?.token ?? '';
  if (token !== config.appToken) return reply.code(401).send({ error: 'bad token' });
  reply.setCookie(sessionCookieName(), sessionTokenFor(config.appToken), {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.authMode !== 'none',
    maxAge: 60 * 60 * 24 * 90,
  });
  return { ok: true };
});

// ---------- Authenticated API ----------
app.register(async (api) => {
  api.addHook('preHandler', requireAuth);

  api.get('/me', async (req) => ({
    identity: req.identity,
    capabilities: {
      send: true,
      files: true,
      newChat: true,
      privateApi: papi.privateApiEnabled(),
      tapback: papi.privateApiEnabled(),
      replyInThread: papi.privateApiEnabled(),
      markRead: papi.privateApiEnabled(),
      groupManage: papi.privateApiEnabled(),
    },
    dbReadable: dbReadable(),
    totalUnread: dbReadable() ? q.totalUnread() : 0,
  }));

  api.get('/contacts', async () => allContacts());

  api.get<{ Querystring: { limit?: string } }>('/chats', async (req) => q.listChats(Number(req.query.limit ?? 200)));

  api.get<{ Params: { id: string } }>('/chats/:id', async (req, reply) => {
    const chat = q.getChat(Number(req.params.id));
    if (!chat) return reply.code(404).send({ error: 'not found' });
    return chat;
  });

  api.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    '/chats/:id/messages',
    async (req) =>
      q.listMessages(Number(req.params.id), {
        before: req.query.before ? Number(req.query.before) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      }),
  );

  api.get<{ Params: { guid: string } }>('/threads/:guid', async (req) => q.listThread(req.params.guid));

  api.get<{ Querystring: { q?: string } }>('/search', async (req) => {
    const term = (req.query.q ?? '').trim();
    if (term.length < 2) return [];
    return q.searchMessages(term, 50);
  });

  api.get<{ Params: { id: string }; Querystring: { thumb?: string; download?: string } }>(
    '/attachments/:id',
    async (req, reply) => {
      const att = q.getAttachment(Number(req.params.id));
      const file = att && resolveAttachmentPath(att);
      if (!att || !file) return reply.code(404).send({ error: 'attachment not found on disk' });
      const name = att.transferName ?? path.basename(file);
      let out = file;
      let mime = att.mimeType ?? mimeFor(file);
      const wantsImage = att.isImage || mime.startsWith('image/');
      if (wantsImage && !/gif$/i.test(file)) {
        try {
          const r = await webImagePath(file, { thumb: req.query.thumb === '1' });
          out = r.path;
          mime = r.mime;
        } catch (e) {
          req.log.warn({ err: e }, 'image conversion failed; serving original');
        }
      }
      const stat = fs.statSync(out);
      reply.header('content-type', mime);
      reply.header('content-length', stat.size);
      reply.header('cache-control', 'private, max-age=86400');
      if (req.query.download === '1') reply.header('content-disposition', `attachment; filename="${encodeURIComponent(name)}"`);
      return reply.send(fs.createReadStream(out));
    },
  );

  // ----- Sending -----
  api.post<{ Params: { id: string }; Body: { text?: string; replyToGuid?: string; partIndex?: number } }>(
    '/chats/:id/send',
    async (req, reply) => {
      const guid = q.chatGuidForId(Number(req.params.id));
      if (!guid) return reply.code(404).send({ error: 'chat not found' });
      const text = (req.body?.text ?? '').toString();
      if (!text.trim()) return reply.code(400).send({ error: 'empty' });
      if (req.body.replyToGuid) {
        if (!papi.privateApiEnabled()) return reply.code(501).send({ error: 'reply-in-thread requires the Private API (see README)' });
        await papi.replyInThread(guid, text, req.body.replyToGuid, req.body.partIndex ?? 0);
      } else {
        await sender.sendText(guid, text);
      }
      return { ok: true };
    },
  );

  // Multipart: one or more files (+ optional "text" field sent first as its own message)
  api.post<{ Params: { id: string } }>('/chats/:id/files', async (req, reply) => {
    const guid = q.chatGuidForId(Number(req.params.id));
    if (!guid) return reply.code(404).send({ error: 'chat not found' });
    const staged: string[] = [];
    let text = '';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        staged.push(sender.stageUpload(part.filename, buf));
      } else if (part.fieldname === 'text') {
        text = String(part.value ?? '');
      }
    }
    if (text.trim()) await sender.sendText(guid, text);
    for (const f of staged) await sender.sendFile(guid, f);
    return { ok: true, files: staged.length };
  });

  api.post<{ Body: { addresses: string[]; service?: 'iMessage' | 'SMS'; text: string } }>('/messages/new', async (req, reply) => {
    const addresses = (req.body?.addresses ?? []).map((a) => a.trim()).filter(Boolean);
    const service = req.body?.service === 'SMS' ? 'SMS' : 'iMessage';
    const text = (req.body?.text ?? '').toString();
    if (!addresses.length || !text.trim()) return reply.code(400).send({ error: 'addresses and text required' });
    if (addresses.length > 1) {
      if (!papi.privateApiEnabled()) {
        return reply.code(501).send({ error: 'Creating a new group chat requires the Private API. Start it from iPhone/Mac once, then it will appear here.' });
      }
      await papi.createGroup(addresses, text, service);
    } else {
      await sender.sendTextToAddress(service, addresses[0], text);
    }
    return { ok: true };
  });

  // ----- Private API features -----
  api.post<{ Params: { id: string }; Body: { messageGuid: string; reaction: ReactionName; remove?: boolean; partIndex?: number } }>(
    '/chats/:id/react',
    async (req, reply) => {
      if (!papi.privateApiEnabled()) return reply.code(501).send({ error: 'tapbacks require the Private API (see README)' });
      const guid = q.chatGuidForId(Number(req.params.id));
      if (!guid) return reply.code(404).send({ error: 'chat not found' });
      await papi.react(guid, req.body.messageGuid, req.body.reaction, !!req.body.remove, req.body.partIndex ?? 0);
      return { ok: true };
    },
  );

  api.post<{ Params: { id: string }; Body: { unread?: boolean } }>('/chats/:id/read', async (req, reply) => {
    if (!papi.privateApiEnabled()) return reply.code(501).send({ error: 'mark read requires the Private API (see README)' });
    const guid = q.chatGuidForId(Number(req.params.id));
    if (!guid) return reply.code(404).send({ error: 'chat not found' });
    if (req.body?.unread) await papi.markUnread(guid);
    else await papi.markRead(guid);
    return { ok: true };
  });

  api.post<{ Params: { id: string }; Body: { typing: boolean } }>('/chats/:id/typing', async (req, reply) => {
    if (!papi.privateApiEnabled()) return { ok: false };
    const guid = q.chatGuidForId(Number(req.params.id));
    if (!guid) return reply.code(404).send({ error: 'chat not found' });
    await papi.sendTyping(guid, !!req.body?.typing).catch(() => undefined);
    return { ok: true };
  });

  api.post<{ Params: { id: string }; Body: { name?: string; add?: string; remove?: string } }>('/chats/:id/group', async (req, reply) => {
    if (!papi.privateApiEnabled()) return reply.code(501).send({ error: 'group management requires the Private API (see README)' });
    const guid = q.chatGuidForId(Number(req.params.id));
    if (!guid) return reply.code(404).send({ error: 'chat not found' });
    if (req.body?.name !== undefined) await papi.renameGroup(guid, req.body.name);
    if (req.body?.add) await papi.addParticipant(guid, req.body.add);
    if (req.body?.remove) await papi.removeParticipant(guid, req.body.remove);
    return { ok: true };
  });

  api.get('/resolve', async (req) => {
    const addr = String((req.query as Record<string, string>).address ?? '');
    return { address: addr, name: contactName(addr) ?? null };
  });

  // ----- Web Push (installed PWA notifications) -----
  api.get('/push/key', async () => ({ publicKey: push.publicKey(), subscriptions: push.subscriptionCount() }));
  api.post<{ Body: { subscription: { endpoint: string; keys: { p256dh: string; auth: string } } } }>('/push/subscribe', async (req, reply) => {
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return reply.code(400).send({ error: 'bad subscription' });
    push.subscribe(sub, req.identity?.login ?? 'unknown');
    return { ok: true };
  });
  api.post<{ Body: { endpoint: string } }>('/push/unsubscribe', async (req) => {
    if (req.body?.endpoint) push.unsubscribe(req.body.endpoint);
    return { ok: true };
  });

  // ----- Live updates -----
  api.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'hello', totalUnread: dbReadable() ? q.totalUnread() : 0 }));
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
}, { prefix: '/api' });

// ---------- Static web app ----------
if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({ ok: true, note: 'web/dist not built; run `npm run build`' }));
}

app.get('/healthz', async () => ({ ok: true, db: dbReadable(), privateApi: papi.privateApiEnabled() }));

await app.listen({ port: config.port, host: config.host });
watcher.start();
app.log.info(
  { host: config.host, port: config.port, authMode: config.authMode, privateApi: papi.privateApiEnabled(), dataDir: config.dataDir, outbox: dirs.outbox },
  'imessage-assistant listening',
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    watcher.stop();
    await app.close();
    process.exit(0);
  });
}
