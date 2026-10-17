import { execFile } from 'node:child_process';
import fs from 'node:fs';
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

const SEND_TO_NEW = `
on run argv
  set serviceName to item 1 of argv
  set address to item 2 of argv
  set msgText to item 3 of argv
  tell application "Messages"
    if serviceName is "SMS" then
      set targetService to 1st account whose service type = SMS
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

export async function sendTextToAddress(service: 'iMessage' | 'SMS', address: string, text: string): Promise<void> {
  await osascript(SEND_TO_NEW, [service, address, text]);
}

export async function sendFileToAddress(service: 'iMessage' | 'SMS', address: string, filePath: string): Promise<void> {
  await osascript(SEND_FILE_TO_NEW, [service, address, filePath], 120000);
}

/** Triggers the Automation permission prompt and verifies Messages.app is reachable. */
export async function pingMessagesApp(): Promise<string> {
  return (await osascript(PING, [])).trim();
}

/**
 * Messages.app reads the file itself, so uploads are staged in the app data dir (inside the
 * user's home) with a safe filename. Old staged files are pruned.
 */
export function stageUpload(originalName: string, data: Buffer): string {
  const safe = originalName.replace(/[^\w.\-()\s]/g, '_').slice(0, 120) || 'file';
  const file = path.join(dirs.outbox, `${crypto.randomUUID().slice(0, 8)}-${safe}`);
  fs.writeFileSync(file, data);
  pruneOutbox();
  return file;
}

function pruneOutbox() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  try {
    for (const f of fs.readdirSync(dirs.outbox)) {
      const p = path.join(dirs.outbox, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {
    /* ignore */
  }
}
