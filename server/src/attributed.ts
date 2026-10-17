/**
 * Extract plain text from a `message.attributedBody` blob (NSKeyedArchiver/typedstream).
 * Since macOS Ventura, `message.text` is often NULL and the body only lives here.
 * This is a pragmatic parser: find the NSString payload and read its length-prefixed bytes.
 */
export function decodeAttributedBody(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length === 0) return null;
  const buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const marker = Buffer.from('NSString', 'latin1');
  const idx = buf.indexOf(marker);
  if (idx < 0) return null;
  // After "NSString" there are 5 bytes: 0x01 0x94 0x84 0x01 0x2B ('+'), then the length.
  let p = idx + marker.length + 5;
  if (p >= buf.length) return null;
  let len = buf[p];
  p += 1;
  if (len === 0x81) {
    // 16-bit little-endian length follows
    if (p + 2 > buf.length) return null;
    len = buf.readUInt16LE(p);
    p += 2;
  } else if (len === 0x82) {
    if (p + 4 > buf.length) return null;
    len = buf.readUInt32LE(p);
    p += 4;
  }
  if (p + len > buf.length) len = buf.length - p;
  const text = buf.subarray(p, p + len).toString('utf8');
  // Attachments are represented by U+FFFC object replacement chars; keep them (UI can hide).
  return text;
}
