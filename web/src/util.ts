import type { ChatSummary, Message, ReactionName } from '@shared/types';

export function chatTitle(c: ChatSummary): string {
  if (c.displayName) return c.displayName;
  const names = c.participants.map((p) => p.name ?? prettyAddress(p.address));
  if (names.length === 0) return prettyAddress(c.identifier);
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} & ${names.length - 2} others`;
}

export function prettyAddress(a: string): string {
  if (!a) return '';
  if (a.includes('@')) return a;
  const d = a.replace(/[^\d+]/g, '');
  const m = d.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : a;
}

export function senderLabel(m: Message): string {
  if (m.fromMe) return 'You';
  return m.senderName ?? prettyAddress(m.sender ?? '');
}

export function fmtTime(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function fmtFull(ms: number | null): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const REACTION_EMOJI: Record<ReactionName, string> = {
  love: '❤️',
  like: '👍',
  dislike: '👎',
  laugh: '😂',
  emphasize: '‼️',
  question: '❓',
  custom: '✨',
};

export function cleanText(t: string | null): string {
  return (t ?? '').replace(/￼/g, '').replace(/�/g, '').trim();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isServiceSms(service: string | null | undefined) {
  return !!service && /sms|rcs/i.test(service);
}

export function describeSystemMessage(m: Message): string | null {
  if (m.itemType === 0) return null;
  const who = senderLabel(m);
  switch (m.itemType) {
    case 1:
      return m.groupActionType === 1 ? `${who} removed someone from the conversation` : `${who} added someone to the conversation`;
    case 2:
      return `${who} named the conversation “${m.groupTitle ?? ''}”`;
    case 3:
      return `${who} left the conversation`;
    case 4:
      return `${who} shared their location`;
    case 5:
      return 'Audio message kept';
    case 6:
      return 'Group photo changed';
    default:
      return cleanText(m.text) || null;
  }
}
