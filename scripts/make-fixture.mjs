// Creates a small chat.db lookalike for local development / smoke tests.
// usage: node scripts/make-fixture.mjs /tmp/fixture-chat.db
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const out = process.argv[2] ?? '/tmp/fixture-chat.db';
for (const f of [out, out + '-wal', out + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = new DatabaseSync(out);
db.exec(`
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT, service_name TEXT, style INTEGER);
CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, handle_id INTEGER, is_from_me INTEGER DEFAULT 0,
  date INTEGER, date_read INTEGER DEFAULT 0, date_delivered INTEGER DEFAULT 0, date_edited INTEGER DEFAULT 0,
  is_read INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 1, is_delivered INTEGER DEFAULT 1, error INTEGER DEFAULT 0, service TEXT,
  item_type INTEGER DEFAULT 0, group_action_type INTEGER DEFAULT 0, group_title TEXT,
  associated_message_type INTEGER DEFAULT 0, associated_message_guid TEXT,
  thread_originator_guid TEXT, thread_originator_part TEXT, cache_has_attachments INTEGER DEFAULT 0,
  balloon_bundle_id TEXT, is_audio_message INTEGER DEFAULT 0, expressive_send_style_id TEXT);
CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER);
CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, transfer_name TEXT, mime_type TEXT, uti TEXT, total_bytes INTEGER, is_sticker INTEGER DEFAULT 0);
CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
`);
const appleNs = (msAgo) => BigInt(Date.now() - msAgo - 978307200000) * 1000000n;
db.prepare(`INSERT INTO handle VALUES (1,'+15551234567','iMessage'),(2,'+15559876543','iMessage'),(3,'+15550001111','SMS')`).run();
db.prepare(`INSERT INTO chat VALUES (1,'iMessage;-;+15551234567','+15551234567',NULL,'iMessage',45),
  (2,'iMessage;+;chat123','chat123','Weekend Plans','iMessage',43),
  (3,'SMS;-;+15550001111','+15550001111',NULL,'SMS',45)`).run();
db.prepare(`INSERT INTO chat_handle_join VALUES (1,1),(2,1),(2,2),(3,3)`).run();

// attributedBody-only message (text NULL) to exercise the decoder
const body = Buffer.from('from attributedBody only 🎉', 'utf8');
const attributed = Buffer.concat([Buffer.from('streamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString', 'latin1'),
  Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b, body.length]), body, Buffer.from([0x86, 0x84])]);

const ins = db.prepare(`INSERT INTO message (ROWID,guid,text,attributedBody,handle_id,is_from_me,date,date_read,is_read,service,associated_message_type,associated_message_guid,thread_originator_guid,cache_has_attachments)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const join = db.prepare(`INSERT INTO chat_message_join VALUES (?,?,?)`);
let id = 0;
function msg(chat, { text = null, attributed = null, handle = 0, me = 0, ago = 0, read = 1, service = 'iMessage', assocType = 0, assocGuid = null, thread = null, att = 0, guid = null }) {
  id++;
  const d = appleNs(ago);
  ins.run(id, guid ?? `GUID-${id}`, text, attributed, handle, me, d, me ? appleNs(ago - 1000) : 0, read, service, assocType, assocGuid, thread, att);
  join.run(chat, id, d);
  return `GUID-${id}`;
}
const g1 = msg(1, { text: 'Hey, are we still on for tonight?', handle: 1, ago: 3600e3 * 5 });
msg(1, { text: 'Yes! 7pm works', me: 1, ago: 3600e3 * 4.9 });
msg(1, { attributed, handle: 1, ago: 3600e3 * 4.8 });
msg(1, { text: null, handle: 1, me: 0, ago: 3600e3 * 4.7, assocType: 2000, assocGuid: `p:0/GUID-2` }); // ❤️ on "Yes! 7pm works"
msg(1, { text: 'Sounds good', handle: 1, ago: 3600e3 * 4.6, thread: g1 }); // reply in thread
msg(1, { text: 'See you then', handle: 1, ago: 60e3 * 5, read: 0 });
msg(1, { text: 'photo', handle: 1, ago: 60e3 * 4, read: 0, att: 1 });
db.prepare(`INSERT INTO attachment VALUES (1,'ATT-1','~/Library/Messages/Attachments/ab/11/ATT-1/IMG_0001.HEIC','IMG_0001.HEIC','image/heic','public.heic',123456,0)`).run();
db.prepare(`INSERT INTO message_attachment_join VALUES (?,1)`).run(id);

msg(2, { text: 'Who is bringing snacks?', handle: 2, ago: 3600e3 * 30 });
msg(2, { text: 'I got chips', handle: 1, ago: 3600e3 * 29 });
msg(2, { text: 'I will bring drinks', me: 1, ago: 3600e3 * 28 });
msg(2, { text: null, me: 1, ago: 3600e3 * 27, assocType: 2003, assocGuid: `p:0/GUID-8` });
msg(2, { text: null, me: 1, ago: 3600e3 * 26, assocType: 3003, assocGuid: `p:0/GUID-8` }); // removed laugh
msg(2, { text: null, handle: 2, ago: 3600e3 * 26, assocType: 2001, assocGuid: `p:0/GUID-10` });

msg(3, { text: 'Your package has shipped', handle: 3, ago: 86400e3 * 3, service: 'SMS' });
msg(3, { text: 'thanks', me: 1, ago: 86400e3 * 3 + 1, service: 'SMS' });
db.close();
console.log('wrote', out);
