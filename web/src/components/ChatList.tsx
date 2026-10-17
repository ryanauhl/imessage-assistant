import type { ChatSummary } from '@shared/types';
import { chatTitle, fmtTime, isServiceSms } from '../util';

export function Avatar({ chat }: { chat: ChatSummary }) {
  const t = chatTitle(chat);
  const initials = chat.isGroup ? '👥' : t.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '#';
  return <div className={`avatar ${chat.isGroup ? 'group' : ''}`}>{initials}</div>;
}

interface Props {
  pinned: ChatSummary[];
  chats: ChatSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onTogglePin: (guid: string) => void;
}

export function ChatList({ pinned, chats, selectedId, onSelect, onTogglePin }: Props) {
  const row = (c: ChatSummary, isPinned: boolean) => (
        <li key={c.id} className={`chat-row ${c.id === selectedId ? 'selected' : ''} ${isPinned ? 'pinned' : ''}`} onClick={() => onSelect(c.id)}>
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
          <button
            className="icon-btn tiny pin-btn"
            title={isPinned ? 'Unpin' : 'Pin'}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(c.guid);
            }}
          >
            {isPinned ? '📌' : '📍'}
          </button>
        </li>
  );
  return (
    <ul className="chat-list">
      {pinned.length > 0 && <li className="section-label">Pinned</li>}
      {pinned.map((c) => row(c, true))}
      {pinned.length > 0 && chats.length > 0 && <li className="section-label">Recent</li>}
      {chats.map((c) => row(c, false))}
      {chats.length === 0 && pinned.length === 0 && <li className="muted pad">No conversations yet</li>}
    </ul>
  );
}
