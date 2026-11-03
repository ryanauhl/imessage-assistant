import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dirs } from './config.js';

// execFile with stdin: wrap manually since promisify(execFile) has no `input`.
function osascript(script: string, args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'osascript',
      ['-', ...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').toString().trim();
          reject(new Error(friendlyAppleScriptError(msg)));
        } else resolve(stdout.toString());
      },
    );
    child.stdin?.end(script);
  });
}

function friendlyAppleScriptError(msg: string): string {
  if (/not allowed to send Apple events|-1743|Not authorized/i.test(msg)) {
    return 'macOS blocked automation of Messages.app. Grant Automation permission to node (System Settings → Privacy & Security → Automation), or run `npm run doctor` from Terminal to trigger the prompt. Raw: ' + msg;
  }
  if (/Can.t get chat id/i.test(msg)) {
    return 'Messages.app could not find that chat. It may need to be opened once in Messages. Raw: ' + msg;
  }
  return msg || 'osascript failed';
}

const SEND_TO_CHAT = `
on run argv
  set chatGuid to item 1 of argv
  set msgText to item 2 of argv
  tell application "Messages"
    set targetChat to a reference to chat id chatGuid
    send msgText to targetChat
  end tell
end run`;

const SEND_FILE_TO_CHAT = `
on run argv
  set chatGuid to item 1 of argv
  set filePath to item 2 of argv
  tell application "Messages"
    set targetChat to a reference to chat id chatGuid
    send POSIX file filePath to targetChat
  end tell
end run`;

/**
 * Sends through a specific account.
 *
 * This matters because `chat id <guid>` always resolves to the iMessage account, even when the
 * conversation has moved to RCS (verified on macOS 27: a chat whose recent messages are all RCS
 * still reports `service type of account` = iMessage). Addressing the participant under the
 * correct account is what actually picks the transport.
 */
const SEND_TO_NEW = `
on run argv
  set serviceName to item 1 of argv
  set address to item 2 of argv
  set msgText to item 3 of argv
  tell application "Messages"
    if serviceName is "SMS" then
      set targetService to 1st account whose service type = SMS
    else if serviceName is "RCS" then
      set targetService to 1st account whose service type = RCS
    else
      set targetService to 1st account whose service type = iMessage
    end if
    set targetBuddy to participant address of targetService
    send msgText to targetBuddy
  end tell
end run`;

const SEND_FILE_TO_NEW = `
on run argv
  set serviceName to item 1 of argv
  set address to item 2 of argv
  set filePath to item 3 of argv
  tell application "Messages"
    if serviceName is "SMS" then
      set targetService to 1st account whose service type = SMS
    else if serviceName is "RCS" then
      set targetService to 1st account whose service type = RCS
    else
      set targetService to 1st account whose service type = iMessage
    end if
    set targetBuddy to participant address of targetService
    send POSIX file filePath to targetBuddy
  end tell
end run`;

const PING = `tell application "Messages" to get name`;

export async function sendText(chatGuid: string, text: string): Promise<void> {
  if (!text.trim()) throw new Error('Empty message');
  await osascript(SEND_TO_CHAT, [chatGuid, text]);
}

export async function sendFile(chatGuid: string, filePath: string): Promise<void> {
  await osascript(SEND_FILE_TO_CHAT, [chatGuid, filePath], 120000);
}

export type SendService = 'iMessage' | 'SMS' | 'RCS';

export async function sendTextToAddress(service: SendService, address: string, text: string): Promise<void> {
  await osascript(SEND_TO_NEW, [service, address, text]);
}

export async function sendFileToAddress(service: SendService, address: string, filePath: string): Promise<void> {
  await osascript(SEND_FILE_TO_NEW, [service, address, filePath], 120000);
}

/** Triggers the Automation permission prompt and verifies Messages.app is reachable. */
export async function pingMessagesApp(): Promise<string> {
  return (await osascript(PING, [])).trim();
}

/**
 * Messages.app reads the staged file itself and it is sandboxed, so the file MUST live under a
 * path in its entitlements (see config.uploadStagingDir). Staging elsewhere makes Messages create
 * an empty message with no attachment and nothing reaches the recipient.
 *
 * Each upload gets its own subdirectory so the original filename is preserved exactly: the
 * recipient sees "photo.png", not "a1b2c3d4-photo.png".
 */
export function stageUpload(originalName: string, data: Buffer): string {
  const safe = originalName.replace(/[/\\]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  const dir = path.join(dirs.outbox, crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safe);
  fs.writeFileSync(file, data);
  // Messages runs as the same user but under a different sandbox; make sure it can read it.
  fs.chmodSync(dir, 0o755);
  fs.chmodSync(file, 0o644);
  pruneOutbox();
  return file;
}

function pruneOutbox() {
  // Messages keeps reading the file while the transfer is in flight, so keep them a while.
  const cutoff = Date.now() - 6 * 3600 * 1000;
  try {
    for (const f of fs.readdirSync(dirs.outbox)) {
      const p = path.join(dirs.outbox, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}

/** True when the staging dir exists and Messages.app is allowed to read from it. */
export function stagingUsable(): { ok: boolean; dir: string; reason?: string } {
  const dir = dirs.outbox;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) {
    return { ok: false, dir, reason: (e as Error).message };
  }
  // Messages is sandboxed; these are the prefixes its entitlements allow.
  const allowed = [
    '/private/var/tmp/com.apple.messages',
    path.join(os.homedir(), 'Library/Messages'),
    path.join(os.homedir(), 'Downloads'),
  ];
  if (!allowed.some((a) => dir === a || dir.startsWith(a + path.sep))) {
    return { ok: false, dir, reason: 'path is outside the sandbox paths Messages.app can read' };
  }
  return { ok: true, dir };
}
