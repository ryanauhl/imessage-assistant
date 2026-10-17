import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/**
 * Resolves phone numbers / emails to display names using the local AddressBook SQLite stores.
 * Requires Full Disk Access (same grant as chat.db). Fails soft: returns no names.
 */
let cache: Map<string, string> | null = null;
let cacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

export function normalizeAddress(addr: string): string {
  const a = addr.trim().toLowerCase();
  if (a.includes('@')) return a;
  const digits = a.replace(/\D/g, '');
  // Compare on last 10 digits for NANP-style numbers; otherwise full digit string.
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function findAddressBookDbs(): string[] {
  const out: string[] = [];
  const root = config.addressBookDir;
  try {
    const main = path.join(root, 'AddressBook-v22.abcddb');
    if (fs.existsSync(main)) out.push(main);
    const sources = path.join(root, 'Sources');
    if (fs.existsSync(sources)) {
      for (const src of fs.readdirSync(sources)) {
        const f = path.join(sources, src, 'AddressBook-v22.abcddb');
        if (fs.existsSync(f)) out.push(f);
      }
    }
  } catch {
    /* no access */
  }
  return out;
}

function buildCache(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of findAddressBookDbs()) {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true, readBigInts: true });
      const rows = db
        .prepare(
          `SELECT r.ZFIRSTNAME AS first, r.ZLASTNAME AS last, r.ZORGANIZATION AS org, r.ZNICKNAME AS nick,
                  p.ZFULLNUMBER AS phone, NULL AS email
             FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER
           UNION ALL
           SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, NULL, e.ZADDRESS
             FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER`,
        )
        .all() as Array<{ first: string | null; last: string | null; org: string | null; nick: string | null; phone: string | null; email: string | null }>;
      for (const r of rows) {
        const name = [r.first, r.last].filter(Boolean).join(' ').trim() || r.nick || r.org;
        if (!name) continue;
        const key = r.phone ? normalizeAddress(r.phone) : r.email ? normalizeAddress(r.email) : null;
        if (key && !map.has(key)) map.set(key, name);
      }
    } catch {
      /* skip unreadable source */
    } finally {
      try {
        db?.close();
      } catch {
        /* ignore */
      }
    }
  }
  return map;
}

export function contactName(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  const now = Date.now();
  if (!cache || now - cacheAt > TTL_MS) {
    cache = buildCache();
    cacheAt = now;
  }
  return cache.get(normalizeAddress(address));
}

export function allContacts(): Record<string, string> {
  contactName('x'); // ensure cache
  return Object.fromEntries(cache ?? []);
}
