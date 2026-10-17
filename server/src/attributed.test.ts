import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeAttributedBody } from './attributed.js';

function fake(text: string): Uint8Array {
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.from('streamtyped...NSString', 'latin1');
  const tail = Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]);
  const len = body.length < 0x80 ? Buffer.from([body.length]) : Buffer.concat([Buffer.from([0x81]), Buffer.from([body.length & 0xff, body.length >> 8])]);
  return Buffer.concat([head, tail, len, body, Buffer.from([0x86, 0x84])]);
}

test('decodes short string', () => {
  assert.equal(decodeAttributedBody(fake('hello world')), 'hello world');
});

test('decodes long string with 16-bit length', () => {
  const long = 'x'.repeat(300);
  assert.equal(decodeAttributedBody(fake(long)), long);
});

test('returns null for garbage', () => {
  assert.equal(decodeAttributedBody(new Uint8Array([1, 2, 3])), null);
  assert.equal(decodeAttributedBody(null), null);
});
