import { getDb, appleDateToMs } from './db.js';
import { decodeAttributedBody } from './attributed.js';
import { contactName } from './contacts.js';
import type { Attachment, ChatSummary, Message, Participant, Reaction, ReactionName } from './types.js';

type Row = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const REACTION_TYPES: Record<number, ReactionName> = {
  0: 'love',
  1: 'like',
  2: 'dislike',
  3: 'laugh',
  4: 'emphasize',
  5: 'question',
  6: 'custom', // custom emoji tapback (macOS 15+)
};

function messageText(row: Row): string | null {
  const t = s(row.text);
  if (t && t.trim().length > 0) return t;
  const decoded = decodeAttributedBody(row.attributedBody as Uint8Array | null);
  return decoded && decoded.trim().length > 0 ? decoded : t;
}

export function listChats(limit = 200): ChatSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.ROWID AS id, c.guid, c.chat_identifier AS identifier, c.display_name AS displayName,
              c.service_name AS service, c.style,
              (SELECT MAX(cmj.message_date) FROM chat_message_join cmj WHERE cmj.chat_id = c.ROWID) AS lastDate
         FROM chat c
        WHERE lastDate IS NOT NULL
        ORDER BY lastDate DESC
        LIMIT ?`,
    )
    .all(limit) as Row[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => n(r.id));
  const ph = ids.map(() => '?').join(',');

  const partRows = db
    .prepare(
      `SELECT chj.chat_id AS chatId, h.id AS address, h.service
         FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id IN (${ph})`,
    )
    .all(...ids) as Row[];
  const parts = new Map<number, Participant[]>();
  for (const p of partRows) {
    const list = parts.get(n(p.chatId)) ?? [];
    const address = String(p.address);
    if (!list.some((x) => x.address === address)) {
      list.push({ address, service: String(p.service), name: contactName(address) });
    }
    parts.set(n(p.chatId), list);
  }

  // chat.service_name reflects the handle's *capability*, not the conversation: a thread with
  // 13k iMessages and one stray RCS row is labelled "RCS". Derive it from recent messages instead.
  const serviceRows = db
    .prepare(
      `WITH recent AS (
         SELECT cmj.chat_id AS chatId, m.service AS service,
                ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) AS rn
           FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
          WHERE cmj.chat_id IN (${ph}) AND m.service IS NOT NULL
       )
       SELECT chatId, service, COUNT(*) AS n FROM recent WHERE rn <= 25 GROUP BY chatId, service`,
    )
    .all(...ids) as Row[];
  const serviceByChat = new Map<number, { service: string; n: number }>();
  for (const r of serviceRows) {
    const id = n(r.chatId);
    const cur = serviceByChat.get(id);
    const cand = { service: String(r.service), n: n(r.n) };
    if (!cur || cand.n > cur.n) serviceByChat.set(id, cand);
  }

  const unreadRows = db
    .prepare(
      `SELECT cmj.chat_id AS chatId, COUNT(*) AS unread
         FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id IN (${ph}) AND m.is_from_me = 0 AND m.is_read = 0
          AND m.associated_message_type = 0 AND m.item_type = 0
        GROUP BY cmj.chat_id`,
    )
    .all(...ids) as Row[];
  const unread = new Map<number, number>(unreadRows.map((r) => [n(r.chatId), n(r.unread)]));

  // Last message preview per chat
  const lastStmt = db.prepare(
    `SELECT m.text, m.attributedBody, m.is_from_me AS fromMe, m.cache_has_attachments AS hasAtt,
            m.associated_message_type AS assoc, m.item_type AS itemType
       FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
      WHERE cmj.chat_id = ?
      ORDER BY m.date DESC LIMIT 1`,
  );

  return rows.map((r) => {
    const id = n(r.id);
    const last = lastStmt.get(id) as Row | undefined;
    let lastText: string | null = null;
    let lastFromMe = false;
    if (last) {
      lastFromMe = n(last.fromMe) === 1;
      const assoc = n(last.assoc);
      if (assoc >= 2000 && assoc < 4000) lastText = 'Reacted to a message';
      else lastText = messageText(last) ?? (n(last.hasAtt) ? 'Attachment' : null);
      if (lastText) lastText = lastText.replace(/￼/g, '').trim() || (n(last.hasAtt) ? 'Attachment' : '');
    }
    return {
      id,
      guid: String(r.guid),
      identifier: String(r.identifier),
      displayName: s(r.displayName) || null,
      service: serviceByChat.get(id)?.service ?? String(r.service ?? ''),
      isGroup: n(r.style) === 43,
      participants: parts.get(id) ?? [],
      lastDate: appleDateToMs(r.lastDate as number),
      lastText,
      lastFromMe,
      unread: unread.get(id) ?? 0,
    };
  });
}

export function getChat(id: number): ChatSummary | null {
  return listChats(5000).find((c) => c.id === id) ?? null;
}

export function findChatByGuid(guid: string): { id: number; guid: string } | null {
  const row = getDb().prepare('SELECT ROWID AS id, guid FROM chat WHERE guid = ?').get(guid) as Row | undefined;
  return row ? { id: n(row.id), guid: String(row.guid) } : null;
}

export function chatGuidForId(id: number): string | null {
  const row = getDb().prepare('SELECT guid FROM chat WHERE ROWID = ?').get(id) as Row | undefined;
  return row ? String(row.guid) : null;
}

const MESSAGE_SELECT = `
  SELECT m.ROWID AS id, m.guid, m.text, m.attributedBody, h.id AS sender, m.is_from_me AS fromMe,
         m.date, m.date_read AS dateRead, m.date_delivered AS dateDelivered, m.date_edited AS dateEdited,
         m.is_read AS isRead, m.is_sent AS isSent, m.is_delivered AS isDelivered, m.error, m.service,
         m.item_type AS itemType, m.group_action_type AS groupActionType, m.group_title AS groupTitle,
         m.associated_message_type AS assocType, m.associated_message_guid AS assocGuid,
         m.thread_originator_guid AS threadGuid, m.thread_originator_part AS threadPart,
         m.cache_has_attachments AS hasAtt, m.balloon_bundle_id AS balloonBundleId,
         m.is_audio_message AS isAudio, m.expressive_send_style_id AS expressive,
         cmj.chat_id AS chatId
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN handle h ON h.ROWID = m.handle_id`;

function stripAssocGuid(g: string | null): string | null {
  if (!g) return null;
  // formats: "p:0/GUID", "bp:GUID", "GUID"
  const slash = g.indexOf('/');
  if (g.startsWith('p:') && slash > 0) return g.slice(slash + 1);
  if (g.startsWith('bp:')) return g.slice(3);
  return g;
}

function attachmentsFor(messageIds: number[]): Map<number, Attachment[]> {
  const out = new Map<number, Attachment[]>();
  if (messageIds.length === 0) return out;
  const ph = messageIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT maj.message_id AS messageId, a.ROWID AS id, a.guid, a.filename, a.transfer_name AS transferName,
              a.mime_type AS mimeType, a.uti, a.total_bytes AS totalBytes, a.is_sticker AS isSticker
         FROM message_attachment_join maj JOIN attachment a ON a.ROWID = maj.attachment_id
        WHERE maj.message_id IN (${ph})
        ORDER BY a.ROWID`,
    )
    .all(...messageIds) as Row[];
  for (const r of rows) {
    const mime = s(r.mimeType);
    const uti = s(r.uti);
    const name = s(r.transferName) ?? s(r.filename) ?? '';
    const isImage = !!(mime?.startsWith('image/') || /heic|jpe?g|png|gif|webp/i.test(uti ?? '') || /\.(heic|jpe?g|png|gif|webp)$/i.test(name));
    const isVideo = !!(mime?.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(name));
    const att: Attachment = {
      id: n(r.id),
      guid: String(r.guid),
      filename: s(r.filename),
      transferName: s(r.transferName),
      mimeType: mime,
      uti,
      totalBytes: n(r.totalBytes),
      isImage,
      isVideo,
      isSticker: n(r.isSticker) === 1,
    };
    const list = out.get(n(r.messageId)) ?? [];
    list.push(att);
    out.set(n(r.messageId), list);
  }
  return out;
}

function reactionsFor(guids: string[]): Map<string, Reaction[]> {
  const out = new Map<string, Reaction[]>();
  if (guids.length === 0) return out;
  // associated_message_guid is prefixed ("p:0/<guid>"), so match with LIKE on each guid.
  const where = guids.map(() => 'm.associated_message_guid LIKE ?').join(' OR ');
  const rows = getDb()
    .prepare(
      `SELECT m.guid, m.associated_message_guid AS assocGuid, m.associated_message_type AS assocType,
              m.is_from_me AS fromMe, h.id AS sender, m.date
         FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE m.associated_message_type BETWEEN 2000 AND 3999 AND (${where})
        ORDER BY m.date ASC`,
    )
    .all(...guids.map((g) => `%${g}`)) as Row[];
  // Apply add (2xxx) / remove (3xxx) in order so the final state is correct.
  for (const r of rows) {
    const target = stripAssocGuid(s(r.assocGuid));
    if (!target) continue;
    const t = n(r.assocType);
    const kind = REACTION_TYPES[t % 1000] ?? 'custom';
    const fromMe = n(r.fromMe) === 1;
    const sender = fromMe ? null : s(r.sender);
    const list = out.get(target) ?? [];
    const idx = list.findIndex((x) => x.type === kind && x.fromMe === fromMe && x.sender === sender);
    if (t >= 3000) {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx < 0) {
      list.push({ type: kind, fromMe, sender, senderName: contactName(sender), messageGuid: String(r.guid), date: appleDateToMs(r.date as number) });
    }
    out.set(target, list);
  }
  return out;
}

function hydrate(rows: Row[]): Message[] {
  const ids = rows.map((r) => n(r.id));
  const guids = rows.map((r) => String(r.guid));
  const atts = attachmentsFor(ids);
  const reacts = reactionsFor(guids);
  const db = getDb();

  const replyCountStmt = db.prepare('SELECT COUNT(*) AS c FROM message WHERE thread_originator_guid = ?');
  const originatorStmt = db.prepare(
    `SELECT m.guid, m.text, m.attributedBody, m.is_from_me AS fromMe, h.id AS sender
       FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id WHERE m.guid = ?`,
  );

  return rows.map((r) => {
    const guid = String(r.guid);
    const fromMe = n(r.fromMe) === 1;
    const sender = fromMe ? null : s(r.sender);
    const threadGuid = s(r.threadGuid);
    let replyTo: Message['replyTo'] = null;
    if (threadGuid) {
      const o = originatorStmt.get(threadGuid) as Row | undefined;
      if (o) {
        replyTo = {
          guid: String(o.guid),
          text: messageText(o),
          sender: n(o.fromMe) === 1 ? null : s(o.sender),
          fromMe: n(o.fromMe) === 1,
        };
      }
    }
    const rc = replyCountStmt.get(guid) as Row;
    return {
      id: n(r.id),
      guid,
      chatId: n(r.chatId),
      text: messageText(r),
      sender,
      senderName: contactName(sender),
      fromMe,
      date: appleDateToMs(r.date as number),
      dateRead: appleDateToMs(r.dateRead as number),
      dateDelivered: appleDateToMs(r.dateDelivered as number),
      dateEdited: appleDateToMs(r.dateEdited as number),
      isRead: n(r.isRead) === 1,
      isSent: n(r.isSent) === 1,
      isDelivered: n(r.isDelivered) === 1,
      error: n(r.error),
      service: s(r.service),
      itemType: n(r.itemType),
      groupActionType: n(r.groupActionType),
      groupTitle: s(r.groupTitle),
      balloonBundleId: s(r.balloonBundleId),
      threadOriginatorGuid: threadGuid,
      threadOriginatorPart: s(r.threadPart),
      replyCount: n(rc.c),
      attachments: atts.get(n(r.id)) ?? [],
      reactions: reacts.get(guid) ?? [],
      replyTo,
      isAudioMessage: n(r.isAudio) === 1,
      expressiveSendStyleId: s(r.expressive),
    };
  });
}

/** Messages in a chat, newest first, excluding tapback rows (they are folded into their targets). */
export function listMessages(chatId: number, opts: { before?: number; limit?: number } = {}): Message[] {
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = getDb()
    .prepare(
      `${MESSAGE_SELECT}
        WHERE cmj.chat_id = ? AND m.associated_message_type NOT BETWEEN 2000 AND 3999
          AND (? IS NULL OR m.ROWID < ?)
        ORDER BY m.date DESC, m.ROWID DESC
        LIMIT ?`,
    )
    .all(chatId, opts.before ?? null, opts.before ?? null, limit) as Row[];
  return hydrate(rows).reverse();
}

export function messagesAfterRowid(rowid: number, limit = 200): Message[] {
  const rows = getDb()
    .prepare(`${MESSAGE_SELECT} WHERE m.ROWID > ? ORDER BY m.ROWID ASC LIMIT ?`)
    .all(rowid, limit) as Row[];
  return hydrate(rows);
}

export function maxMessageRowid(): number {
  const r = getDb().prepare('SELECT MAX(ROWID) AS m FROM message').get() as Row;
  return n(r.m);
}

export function getMessageByGuid(guid: string): Message | null {
  const rows = getDb().prepare(`${MESSAGE_SELECT} WHERE m.guid = ? LIMIT 1`).all(guid) as Row[];
  return hydrate(rows)[0] ?? null;
}

/** A thread: the originator message plus all replies to it, oldest first. */
export function listThread(originatorGuid: string): Message[] {
  const rows = getDb()
    .prepare(
      `${MESSAGE_SELECT}
        WHERE (m.guid = ? OR m.thread_originator_guid = ?)
          AND m.associated_message_type NOT BETWEEN 2000 AND 3999
        ORDER BY m.date ASC`,
    )
    .all(originatorGuid, originatorGuid) as Row[];
  return hydrate(rows);
}

export function searchMessages(q: string, limit = 50): Message[] {
  const rows = getDb()
    .prepare(
      `${MESSAGE_SELECT}
        WHERE m.text LIKE ? ESCAPE '\\' AND m.associated_message_type NOT BETWEEN 2000 AND 3999
        ORDER BY m.date DESC LIMIT ?`,
    )
    .all(`%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`, limit) as Row[];
  return hydrate(rows);
}

export function getAttachment(id: number): Attachment | null {
  const r = getDb()
    .prepare(
      `SELECT ROWID AS id, guid, filename, transfer_name AS transferName, mime_type AS mimeType, uti,
              total_bytes AS totalBytes, is_sticker AS isSticker FROM attachment WHERE ROWID = ?`,
    )
    .get(id) as Row | undefined;
  if (!r) return null;
  const mime = s(r.mimeType);
  return {
    id: n(r.id),
    guid: String(r.guid),
    filename: s(r.filename),
    transferName: s(r.transferName),
    mimeType: mime,
    uti: s(r.uti),
    totalBytes: n(r.totalBytes),
    isImage: !!mime?.startsWith('image/'),
    isVideo: !!mime?.startsWith('video/'),
    isSticker: n(r.isSticker) === 1,
  };
}

/** Unread counts only; cheap enough to poll. */
export function totalUnread(): number {
  const r = getDb()
    .prepare('SELECT COUNT(*) AS c FROM message WHERE is_from_me = 0 AND is_read = 0 AND associated_message_type = 0 AND item_type = 0')
    .get() as Row;
  return n(r.c);
}

/** Display title for notifications: group name, else the sender's name. */
export function chatTitleFor(chatId: number, fallback: string): string {
  const r = getDb().prepare('SELECT display_name AS name, style FROM chat WHERE ROWID = ?').get(chatId) as Row | undefined;
  if (!r) return fallback;
  const name = s(r.name);
  if (name) return name;
  if (n(r.style) === 43) {
    const parts = getDb()
      .prepare('SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = ?')
      .all(chatId) as Row[];
    return parts.map((p) => contactName(String(p.id)) ?? String(p.id)).slice(0, 3).join(', ');
  }
  return fallback;
}

/** Handles seen in chat.db (people you've messaged, even without a contact card), matching q. */
export function searchHandles(q: string, limit = 12): Array<{ address: string; service: string; name?: string }> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const digits = needle.replace(/\D/g, '');
  const rows = getDb().prepare('SELECT DISTINCT id AS address, service FROM handle').all() as Row[];
  const out: Array<{ address: string; service: string; name?: string }> = [];
  for (const r of rows) {
    const address = String(r.address);
    const name = contactName(address);
    const digitHit = digits.length >= 3 && !address.includes('@') && address.replace(/\D/g, '').includes(digits);
    if (digitHit || address.toLowerCase().includes(needle) || name?.toLowerCase().includes(needle)) {
      if (!out.some((x) => x.address === address)) out.push({ address, service: String(r.service), name });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Existing 1:1 chat for an address (any service), newest first. */
export function findDirectChat(address: string): { id: number; guid: string } | null {
  const target = address.trim().toLowerCase();
  const digits = target.replace(/\D/g, '');
  const rows = getDb()
    .prepare(
      `SELECT c.ROWID AS id, c.guid, h.id AS address,
              (SELECT MAX(cmj.message_date) FROM chat_message_join cmj WHERE cmj.chat_id = c.ROWID) AS lastDate
         FROM chat c JOIN chat_handle_join chj ON chj.chat_id = c.ROWID JOIN handle h ON h.ROWID = chj.handle_id
        WHERE c.style = 45
        ORDER BY lastDate DESC`,
    )
    .all() as Row[];
  for (const r of rows) {
    const a = String(r.address).toLowerCase();
    if (a === target) return { id: n(r.id), guid: String(r.guid) };
    if (digits.length >= 10 && a.replace(/\D/g, '').endsWith(digits.slice(-10))) return { id: n(r.id), guid: String(r.guid) };
  }
  return null;
}

export function chatUnread(chatId: number): number {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id = ? AND m.is_from_me = 0 AND m.is_read = 0 AND m.associated_message_type = 0 AND m.item_type = 0`,
    )
    .get(chatId) as Row;
  return n(r.c);
}

export function chatParticipants(chatId: number): Array<{ address: string; service: string }> {
  return (
    getDb()
      .prepare('SELECT h.id AS address, h.service FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = ?')
      .all(chatId) as Row[]
  ).map((r) => ({ address: String(r.address), service: String(r.service) }));
}

/** Number of attachment rows across all messages in a chat. */
export function attachmentCountForChat(chatId: number): number {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM chat_message_join cmj
         JOIN message_attachment_join maj ON maj.message_id = cmj.message_id
        WHERE cmj.chat_id = ?`,
    )
    .get(chatId) as Row;
  return n(r.c);
}

/** Polls until the chat has at least `target` attachment rows, or the timeout elapses. */
export async function waitForAttachments(chatId: number, target: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (attachmentCountForChat(chatId) >= target) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * How to reach this chat in Messages.app: an address for 1:1 chats (navigable via the imessage:
 * URL) and the title Messages shows, used to match a group in the sidebar.
 */
export function chatUiTarget(chatId: number): { address: string; title: string } {
  const r = getDb().prepare('SELECT display_name AS dn, style FROM chat WHERE ROWID = ?').get(chatId) as Row | undefined;
  const parts = chatParticipants(chatId);
  const isGroup = n(r?.style) === 43 || parts.length > 1;
  return {
    address: isGroup ? '' : (parts[0]?.address ?? ''),
    title: chatSidebarTitle(chatId),
  };
}

/** The name Messages.app shows for this chat in its sidebar, used to find it for UI automation. */
export function chatSidebarTitle(chatId: number): string {
  const r = getDb().prepare('SELECT display_name AS dn, chat_identifier AS ident, style FROM chat WHERE ROWID = ?').get(chatId) as Row | undefined;
  if (!r) return '';
  const dn = s(r.dn);
  if (dn && dn.trim()) return dn.trim();
  const parts = chatParticipants(chatId);
  if (parts.length === 1) return contactName(parts[0].address) ?? parts[0].address;
  // Unnamed group: Messages lists the members, comma separated.
  return parts.map((p) => contactName(p.address) ?? p.address).join(', ');
}

/** Polls until the chat reports zero unread, returning whatever remains at the deadline. */
export async function waitForUnreadToClear(chatId: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n2 = chatUnread(chatId);
    if (n2 === 0 || Date.now() > deadline) return n2;
    await new Promise((r) => setTimeout(r, 400));
  }
}
