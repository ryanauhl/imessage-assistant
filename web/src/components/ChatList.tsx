import type { ChatSummary } from '@shared/types';
import { chatTitle, fmtTime, isServiceSms } from '../util';

export function Avatar({ chat }: { chat: ChatSummary }) {
  const t = chatTitle(chat);
  const initials = chat.isGroup ? '👥' : t.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '#';
  return <div className={`avatar ${chat.isGroup ? 'group' : ''}`}>{initials}</div>;
}

export function ChatList({ chats, selectedId, onSelect }: { chats: ChatSummary[]; selectedId: number | null; onSelect: (id: number) => void }) {
  return (
    <ul className="chat-list">
      {chats.map((c) => (
        <li key={c.id} className={`chat-row ${c.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(c.id)}>
          <Avatar chat={c} />
          <div className="chat-body">
            <div className="chat-top">
              <span className="chat-name">
                {chatTitle(c)}
                {isServiceSms(c.service) && <span className="pill sms">{c.service}</span>}
              </span>
              <span className="chat-time">{fmtTime(c.lastDate)}</span>
            </div>
            <div className="chat-preview">
              {c.lastFromMe && <span className="muted">You: </span>}
              {c.lastText ?? ''}
            </div>
          </div>
          {c.unread > 0 && <span className="badge">{c.unread}</span>}
        </li>
      ))}
      {chats.length === 0 && <li className="muted pad">No conversations yet</li>}
    </ul>
  );
}
