import { execFile } from 'node:child_process';
import { config } from './config.js';

/**
 * Marks conversations read by driving Messages.app's own UI through the Accessibility API.
 *
 * Apple exposes no API for this. The `imessage:` URL scheme does NOT work (verified on macOS 27:
 * the unread count was unchanged with Messages frontmost and the conversation open). Clicking the
 * conversation in the sidebar does work, because that is the interaction macOS actually responds
 * to. Requires the server's node binary in System Settings > Privacy & Security > Accessibility.
 *
 * Consequences: Messages.app takes focus on the Mac, and only conversations currently visible in
 * the sidebar can be clicked.
 */

/** Finds a conversation by name in the sidebar and clicks it. Title is passed via argv, never interpolated. */
const MARK_READ = `
on digitsOf(t)
  set r to ""
  repeat with c in (characters of t)
    set c to c as text
    if c is in {"0","1","2","3","4","5","6","7","8","9"} then set r to r & c
  end repeat
  return r
end digitsOf

on run argv
  set addr to item 1 of argv
  set target to item 2 of argv
  tell application "Messages" to activate
  delay 0.3
  set navigated to "already"
  tell application "System Events" to tell process "Messages"
    if (count of windows) is 0 then return "ERR:no-window"
    set curTitle to ""
    try
      set curTitle to title of window 1 as text
    end try
    if curTitle is not target then
      if addr is not "" then
        -- The imessage: URL selects the conversation. It does not mark it read on its own,
        -- which is what the menu item below is for.
        do shell script "open " & quoted form of ("imessage://" & addr)
        delay 1.4
        set navigated to "url"
      else
        -- Group chats have no URL form, so fall back to clicking the sidebar row.
        set wp to position of window 1
        set ws to size of window 1
        set sidebarMax to (item 1 of wp) + ((item 1 of ws) * 0.35)
        set hitX to 0
        set hitY to 0
        repeat with e in (entire contents of window 1)
          try
            if role of e as text is "AXStaticText" and hitX is 0 then
              set p to position of e
              if (item 1 of p) < sidebarMax and (description of e as text) is target then
                set s2 to size of e
                set hitX to (item 1 of p) + ((item 1 of s2) / 2)
                set hitY to (item 2 of p) + ((item 2 of s2) / 2)
              end if
            end if
          end try
        end repeat
        if hitX is 0 then return "ERR:not-in-sidebar"
        click at {hitX, hitY}
        delay 1.0
        set navigated to "sidebar"
      end if
    end if
    set finalTitle to ""
    try
      set finalTitle to title of window 1 as text
    end try
    try
      click menu item "Mark as Read" of menu 1 of menu bar item "Conversation" of menu bar 1
      return "OK:" & navigated & ":" & finalTitle
    on error
      -- The item disappears when there is nothing left to mark.
      return "OK:" & navigated & ":" & finalTitle
    end try
  end tell
end run`;

const PING = `tell application "System Events" to return UI elements enabled`;

function osascript(script: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'osascript',
      ['-', ...args],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).toString().trim().slice(0, 300)));
        else resolve(stdout.toString().trim());
      },
    );
    child.stdin?.end(script);
  });
}

let availability: { ok: boolean; checkedAt: number } | null = null;
const AVAIL_TTL = 60_000;

/** True when the Accessibility permission is granted to this process. Cached briefly. */
export async function guiAutomationAvailable(): Promise<boolean> {
  if (config.markReadMethod === 'off') return false;
  if (availability && Date.now() - availability.checkedAt < AVAIL_TTL) return availability.ok;
  let ok = false;
  try {
    ok = (await osascript(PING, [], 8000)).toLowerCase() === 'true';
  } catch {
    ok = false;
  }
  availability = { ok, checkedAt: Date.now() };
  return ok;
}

// Clicking is global UI state, so only one automation may run at a time.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export type MarkReadResult = { ok: true; how: string; title: string } | { ok: false; reason: string };

/** Selects the conversation in Messages.app and invokes Conversation > Mark as Read. */
export function markChatReadViaUI(opts: { address: string; title: string }): Promise<MarkReadResult> {
  return serialize(async () => {
    let out: string;
    try {
      out = await osascript(MARK_READ, [opts.address, opts.title], 30000);
    } catch (e) {
      return { ok: false as const, reason: `automation failed: ${(e as Error).message}` };
    }
    if (out.startsWith('OK:')) {
      const [, how, ...rest] = out.split(':');
      return { ok: true as const, how, title: rest.join(':') };
    }
    if (out === 'ERR:not-in-sidebar') {
      return { ok: false as const, reason: `"${opts.title}" is not visible in the Messages sidebar on the Mac` };
    }
    if (out === 'ERR:no-window') return { ok: false as const, reason: 'Messages.app has no open window' };
    return { ok: false as const, reason: out || 'unknown automation result' };
  });
}
