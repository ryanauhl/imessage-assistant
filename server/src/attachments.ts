import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, dirs } from './config.js';
import type { Attachment } from './types.js';

const execFileP = promisify(execFile);

export function resolveAttachmentPath(att: Attachment): string | null {
  if (!att.filename) return null;
  let p = att.filename;
  if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
  p = path.resolve(p);
  // Only ever serve files from the Messages attachments directory.
  if (!p.startsWith(config.attachmentsRoot + path.sep)) return null;
  return fs.existsSync(p) ? p : null;
}

const WEB_IMAGE = /\.(jpe?g|png|gif|webp)$/i;

/**
 * Browsers can't display HEIC/TIFF; convert with the built-in `sips` into the cache dir.
 * Also produces downscaled thumbnails for the message list.
 */
export async function webImagePath(src: string, opts: { thumb?: boolean }): Promise<{ path: string; mime: string }> {
  const needsConvert = !WEB_IMAGE.test(src);
  if (!needsConvert && !opts.thumb) return { path: src, mime: mimeFor(src) };
  const key = crypto.createHash('sha1').update(src + (opts.thumb ? ':t' : ':f')).digest('hex');
  const out = path.join(dirs.cache, `${key}.jpg`);
  if (!fs.existsSync(out)) {
    const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85'];
    if (opts.thumb) args.push('-Z', '512');
    args.push(src, '--out', out);
    await execFileP('sips', args, { timeout: 60000 });
  }
  return { path: out, mime: 'image/jpeg' };
}

export function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.mov': 'video/quicktime',
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.m4a': 'audio/mp4',
      '.caf': 'audio/x-caf',
      '.amr': 'audio/amr',
      '.pdf': 'application/pdf',
      '.vcf': 'text/vcard',
      '.txt': 'text/plain',
    }[ext] ?? 'application/octet-stream'
  );
}
