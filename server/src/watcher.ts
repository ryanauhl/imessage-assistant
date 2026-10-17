import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { config } from './config.js';
import { maxMessageRowid, messagesAfterRowid, totalUnread } from './queries.js';
import { closeDb } from './db.js';
import type { Message } from './types.js';

export interface ChangeEvent {
  type: 'change';
  newMessages: Message[];
  /** chat ids touched by new rows (including tapbacks) */
  chatIds: number[];
  totalUnread: number;
}

/**
 * Detects chat.db changes. Messages.app writes through the WAL, so we watch the -wal file
 * mtime (cheap) and fall back to polling MAX(ROWID). Read-receipt / delivery updates don't add
 * rows, so any mtime change also triggers a generic "change" so clients can refetch.
 */
export class DbWatcher extends EventEmitter {
  private lastRowid = 0;
  private lastUnread = -1;
  private timer: NodeJS.Timeout | null = null;
  private lastMtime = 0;

  start() {
    try {
      this.lastRowid = maxMessageRowid();
      this.lastUnread = totalUnread();
    } catch {
      this.lastRowid = 0;
    }
    this.timer = setInterval(() => this.tick(), config.pollMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private mtime(): number {
    let m = 0;
    for (const f of [config.chatDb, config.chatDb + '-wal']) {
      try {
        m = Math.max(m, fs.statSync(f).mtimeMs);
      } catch {
        /* ignore */
      }
    }
    return m;
  }

  private tick() {
    const m = this.mtime();
    if (m === this.lastMtime) return;
    this.lastMtime = m;
    try {
      const newMessages = messagesAfterRowid(this.lastRowid);
      if (newMessages.length) this.lastRowid = Math.max(this.lastRowid, ...newMessages.map((x) => x.id));
      const unread = totalUnread();
      const unreadChanged = unread !== this.lastUnread;
      this.lastUnread = unread;
      const ev: ChangeEvent = {
        type: 'change',
        newMessages,
        chatIds: [...new Set(newMessages.map((x) => x.chatId))],
        totalUnread: unread,
      };
      void unreadChanged;
      this.emit('change', ev);
    } catch (e) {
      // DB may be mid-checkpoint; reopen next tick.
      closeDb();
      this.emit('error', e);
    }
  }
}
