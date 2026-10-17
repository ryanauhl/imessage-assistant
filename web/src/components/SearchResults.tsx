import type { ChatSummary, Message } from '@shared/types';
import { chatTitle, cleanText, fmtTime, senderLabel } from '../util';

export function SearchResults({ results, chats, onOpen }: { results: Message[]; chats: ChatSummary[]; onOpen: (chatId: number) => void }) {
  const byId = new Map(chats.map((c) => [c.id, c]));
  return (
    <ul className="chat-list">
      {results.map((m) => {
        const chat = byId.get(m.chatId);
        return (
          <li key={m.id} className="chat-row" onClick={() => onOpen(m.chatId)}>
            <div className="chat-body">
              <div className="chat-top">
                <span className="chat-name">{chat ? chatTitle(chat) : `Chat ${m.chatId}`}</span>
                <span className="chat-time">{fmtTime(m.date)}</span>
              </div>
              <div className="chat-preview">
                <span className="muted">{senderLabel(m)}: </span>
                {cleanText(m.text)}
              </div>
            </div>
          </li>
        );
      })}
      {results.length === 0 && <li className="muted pad">No results</li>}
    </ul>
  );
}
