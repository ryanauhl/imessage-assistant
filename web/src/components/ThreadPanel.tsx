import { useCallback, useEffect, useState } from 'react';
import type { ChatSummary, Message, ReactionName } from '@shared/types';
import { api, type Me } from '../api';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';

interface Props {
  originatorGuid: string;
  chat: ChatSummary;
  me: Me;
  onClose: () => void;
  notify: (m: string) => void;
  onReact: (m: Message, r: ReactionName, remove: boolean) => void;
}

export function ThreadPanel({ originatorGuid, chat, me, onClose, notify, onReact }: Props) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const load = useCallback(() => api.thread(originatorGuid).then(setMsgs).catch((e) => notify((e as Error).message)), [originatorGuid, notify]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [load]);
  const root = msgs[0];

  return (
    <div className="thread-panel">
      <header className="conv-head">
        <strong>Thread</strong>
        <div className="spacer" />
        <button className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="messages">
        {msgs.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            isGroup={chat.isGroup}
            showSender={!m.fromMe}
            caps={me.capabilities}
            isLast={false}
            compact
            onReply={() => undefined}
            onOpenThread={() => undefined}
            onReact={(r, remove) => onReact(m, r, remove)}
          />
        ))}
      </div>
      {root && (
        <Composer
          chatId={chat.id}
          replyTo={root}
          canReply={me.capabilities.replyInThread}
          canType={false}
          onCancelReply={onClose}
          onSend={async (text, files) => {
            if (files.length) await api.sendFiles(chat.id, files, text);
            else await api.send(chat.id, text, root.guid);
            setTimeout(() => void load(), 1500);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}
