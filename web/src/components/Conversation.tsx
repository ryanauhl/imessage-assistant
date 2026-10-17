import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatSummary, Message } from '@shared/types';
import { api, type Me } from '../api';
import { chatTitle, fmtFull, prettyAddress } from '../util';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { ThreadPanel } from './ThreadPanel';

interface Props {
  chat: ChatSummary;
  me: Me;
  onBack: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  notify: (m: string) => void;
  registerIncoming: (fn: (msgs: Message[], chatIds: number[]) => void) => void;
}

export function Conversation({ chat, me, onBack, pinned, onTogglePin, notify, registerIncoming }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const prevHeight = useRef(0);

  const reload = useCallback(async () => {
    try {
      const list = await api.messages(chat.id);
      setMessages(list);
      setHasMore(list.length >= 60);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [chat.id, notify]);

  useEffect(() => {
    stickBottom.current = true;
    void reload();
  }, [reload]);

  // Live updates: new rows for this chat → append; tapbacks/read receipts → refetch quietly
  useEffect(() => {
    registerIncoming((msgs, chatIds) => {
      if (!chatIds.includes(chat.id) && msgs.length) return;
      const mine = msgs.filter((m) => m.chatId === chat.id);
      if (mine.length) {
        // reload to get reactions/receipts folded correctly
        void reload();
      } else {
        // no new rows but DB changed: receipts / read state
        void reload();
      }
    });
    return () => registerIncoming(() => undefined);
  }, [chat.id, registerIncoming, reload]);

  // Mark as read when viewing (if Private API available) — and auto-refresh shortly after.
  useEffect(() => {
    if (!me.capabilities.markRead || chat.unread === 0) return;
    const t = window.setTimeout(() => void api.markRead(chat.id).catch(() => undefined), 800);
    return () => window.clearTimeout(t);
  }, [chat.id, chat.unread, me.capabilities.markRead]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickBottom.current) el.scrollTop = el.scrollHeight;
    else if (prevHeight.current) el.scrollTop += el.scrollHeight - prevHeight.current;
    prevHeight.current = 0;
  }, [messages]);

  // Keep pinned to the bottom when content grows after render (images load, fallbacks swap in).
  useEffect(() => {
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const onScroll = async () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 80 && hasMore && !loading && messages.length) {
      setLoading(true);
      try {
        const older = await api.messages(chat.id, messages[0].id);
        prevHeight.current = el.scrollHeight;
        setHasMore(older.length >= 60);
        setMessages((cur) => [...older, ...cur]);
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  };

  const send = async (text: string, files: File[]) => {
    stickBottom.current = true;
    if (files.length) await api.sendFiles(chat.id, files, text);
    else await api.send(chat.id, text, replyTo?.guid);
    setReplyTo(null);
  };

  const react = async (m: Message, reaction: Parameters<typeof api.react>[2], remove: boolean) => {
    try {
      await api.react(chat.id, m.guid, reaction, remove);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  let lastDay = '';
  let lastSender: string | null | undefined;
  let lastTs = 0;

  return (
    <div className="conversation">
      <header className="conv-head">
        <button className="icon-btn back" onClick={onBack}>
          ‹
        </button>
        <div className="conv-title" onClick={() => setShowInfo((s) => !s)}>
          <strong>{chatTitle(chat)}</strong>
          <span className="muted small">
            {chat.isGroup ? `${chat.participants.length} people · ` : ''}
            {chat.service}
          </span>
        </div>
        <div className="spacer" />
        <button className={`icon-btn ${pinned ? 'active' : ''}`} title={pinned ? 'Unpin conversation' : 'Pin conversation'} onClick={onTogglePin}>
          {pinned ? '📌' : '📍'}
        </button>
        {me.capabilities.markRead && (
          <button className="icon-btn" title="Mark as unread" onClick={() => void api.markRead(chat.id, true).catch((e) => notify(e.message))}>
            ●
          </button>
        )}
        <button className="icon-btn" title="Details" onClick={() => setShowInfo((s) => !s)}>
          ⓘ
        </button>
      </header>

      {showInfo && (
        <div className="conv-info">
          <ul>
            {chat.participants.map((p) => (
              <li key={p.address}>
                <strong>{p.name ?? prettyAddress(p.address)}</strong> <span className="muted">{p.name ? prettyAddress(p.address) : ''} · {p.service}</span>
                {me.capabilities.groupManage && chat.isGroup && (
                  <button className="link" onClick={() => void api.group(chat.id, { remove: p.address }).catch((e) => notify(e.message))}>
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {me.capabilities.groupManage && chat.isGroup && (
            <div className="row">
              <button
                className="link"
                onClick={() => {
                  const name = prompt('Group name', chat.displayName ?? '');
                  if (name !== null) void api.group(chat.id, { name }).catch((e) => notify(e.message));
                }}
              >
                rename
              </button>
              <button
                className="link"
                onClick={() => {
                  const add = prompt('Phone or email to add');
                  if (add) void api.group(chat.id, { add }).catch((e) => notify(e.message));
                }}
              >
                add person
              </button>
            </div>
          )}
          <div className="muted small">chat guid: {chat.guid}</div>
        </div>
      )}

      <div className="messages" ref={scrollRef} onScroll={() => void onScroll()}>
        <div className="messages-inner" ref={innerRef}>
        {loading && messages.length === 0 && <div className="muted centered">Loading…</div>}
        {!hasMore && messages.length > 0 && <div className="muted centered small">Beginning of conversation</div>}
        {messages.map((m) => {
          const day = m.date ? new Date(m.date).toDateString() : '';
          const showDay = day !== lastDay;
          const gap = (m.date ?? 0) - lastTs > 15 * 60 * 1000;
          const showSender = chat.isGroup && !m.fromMe && (m.sender !== lastSender || gap);
          lastDay = day;
          lastSender = m.sender;
          lastTs = m.date ?? 0;
          return (
            <div key={m.id}>
              {(showDay || gap) && <div className="day-sep">{fmtFull(m.date)}</div>}
              <MessageBubble
                message={m}
                isGroup={chat.isGroup}
                showSender={showSender}
                caps={me.capabilities}
                onReply={() => setReplyTo(m)}
                onOpenThread={() => setThread(m.threadOriginatorGuid ?? m.guid)}
                onReact={(r, remove) => void react(m, r, remove)}
                isLast={m === messages[messages.length - 1]}
              />
            </div>
          );
        })}
        </div>
      </div>

      <Composer
        chatId={chat.id}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={send}
        notify={notify}
        canReply={me.capabilities.replyInThread}
        canType={me.capabilities.privateApi}
      />

      {thread && (
        <ThreadPanel
          originatorGuid={thread}
          chat={chat}
          me={me}
          onClose={() => setThread(null)}
          notify={notify}
          onReact={(m, r, remove) => void react(m, r, remove)}
        />
      )}
    </div>
  );
}
