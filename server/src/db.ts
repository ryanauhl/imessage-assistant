import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { config } from './config.js';

let db: DatabaseSync | null = null;

export class DbUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DbUnavailableError';
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;
  try {
    fs.accessSync(config.chatDb, fs.constants.R_OK);
  } catch {
    throw new DbUnavailableError(
      `Cannot read ${config.chatDb}. Grant Full Disk Access to the node binary (see README).`,
    );
  }
  db = new DatabaseSync(config.chatDb, { readOnly: true, readBigInts: true });
  // Don't hold locks for long and don't block Messages.app.
  db.exec('PRAGMA query_only = 1');
  return db;
}

export function closeDb() {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  db = null;
}

export function dbReadable(): boolean {
  try {
    getDb().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/** Apple Messages stores dates as nanoseconds (newer) or seconds (older) since 2001-01-01. */
const APPLE_EPOCH_MS = 978307200000;
export function appleDateToMs(v: number | bigint | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!n) return null;
  if (Math.abs(n) > 1e12) return Math.round(n / 1e6) + APPLE_EPOCH_MS;
  return n * 1000 + APPLE_EPOCH_MS;
}
