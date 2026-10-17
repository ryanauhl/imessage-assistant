import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/**
 * Resolves phone numbers / emails to display names using the local AddressBook SQLite stores.
 * Requires Full Disk Access (same grant as chat.db). Fails soft: returns no names.
 */
let cache: Map<string, string> | null = null;
let entries: ContactEntry[] = [];

export interface ContactEntry {
  name: string;
  address: string; // as stored in Contacts (display form)
  kind: 'phone' | 'email';
}
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
  const list: ContactEntry[] = [];
  const seen = new Set<string>();
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
        if (key && !seen.has(key)) {
          seen.add(key);
          list.push({ name, address: (r.phone ?? r.email ?? '').trim(), kind: r.phone ? 'phone' : 'email' });
        }
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
  entries = list;
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

/** Case-insensitive search over contact names and addresses. */
export function searchContacts(q: string, limit = 12): ContactEntry[] {
  contactName('x'); // ensure cache
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const digits = needle.replace(/\D/g, '');
  const out: ContactEntry[] = [];
  for (const e of entries) {
    const nameHit = e.name.toLowerCase().includes(needle);
    const addrHit = e.address.toLowerCase().includes(needle) || (digits.length >= 3 && e.kind === 'phone' && e.address.replace(/\D/g, '').includes(digits));
    if (nameHit || addrHit) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  // names starting with the query first
  return out.sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)));
}
