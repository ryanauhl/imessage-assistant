import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatSummary, Message } from '@shared/types';
import { api, ApiError, connectWs, type Me } from './api';
import { ChatList } from './components/ChatList';
import { Conversation } from './components/Conversation';
import { NewMessageDialog } from './components/NewMessageDialog';
import { Login } from './components/Login';
import { SearchResults } from './components/SearchResults';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [authError, setAuthError] = useState<{ needToken: boolean; message: string } | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const m = location.hash.match(/chat=(\d+)/);
    return m ? Number(m[1]) : null;
  });
  const [connected, setConnected] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const refreshTimer = useRef<number | null>(null);
  const incomingRef = useRef<(msgs: Message[], chatIds: number[]) => void>(() => undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setAuthError(null);
      document.title = m.totalUnread ? `(${m.totalUnread}) Messages` : 'Messages';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const b = e.body as { needToken?: boolean } | undefined;
        setAuthError({ needToken: !!b?.needToken, message: e.message });
      } else if (e instanceof ApiError && e.status === 503) {
        setAuthError({ needToken: false, message: e.message });
      } else notify((e as Error).message);
    }
  }, [notify]);

  const loadChats = useCallback(async () => {
    try {
      setChats(await api.chats());
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) notify((e as Error).message);
    }
  }, [notify]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!me) return;
    void loadChats();
    const stop = connectWs(
      (ev) => {
        if (ev.type === 'hello') return;
        document.title = ev.totalUnread ? `(${ev.totalUnread}) Messages` : 'Messages';
        incomingRef.current(ev.newMessages, ev.chatIds);
        // debounce list refresh (read receipts, previews, unread counts)
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void loadChats(), 300);
        const inbound = ev.newMessages.filter((m) => !m.fromMe && m.itemType === 0);
        if (inbound.length && document.visibilityState !== 'visible' && Notification.permission === 'granted') {
          const m = inbound[inbound.length - 1];
          new Notification(m.senderName ?? m.sender ?? 'Message', { body: (m.text ?? 'Attachment').replace(/￼/g, '').slice(0, 140) });
        }
      },
      setConnected,
    );
    return stop;
  }, [me, loadChats]);

  useEffect(() => {
    if (!search.trim() || search.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const t = window.setTimeout(() => {
      api.search(search.trim()).then(setSearchResults).catch((e) => notify((e as Error).message));
    }, 250);
    return () => window.clearTimeout(t);
  }, [search, notify]);

  const selected = useMemo(() => chats.find((c) => c.id === selectedId) ?? null, [chats, selectedId]);

  const openChat = (id: number) => {
    setSelectedId(id);
    history.replaceState(null, '', `#chat=${id}`);
    setMobileShowChat(true);
    setSearch('');
  };

  if (authError) {
    return <Login needToken={authError.needToken} message={authError.message} onLoggedIn={() => void loadMe()} />;
  }
  if (!me) return <div className="centered muted">Loading…</div>;

  return (
    <div className={`app ${mobileShowChat ? 'show-chat' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar-head">
          <div className="title-row">
            <h1>Messages</h1>
            <button className="icon-btn" title="New message" onClick={() => setShowNew(true)}>
              ✎
            </button>
          </div>
          <input className="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </header>
        {searchResults ? (
          <SearchResults results={searchResults} chats={chats} onOpen={openChat} />
        ) : (
          <ChatList chats={chats} selectedId={selectedId} onSelect={openChat} />
        )}
        <footer className="sidebar-foot">
          <span className={`dot ${connected ? 'on' : 'off'}`} /> {connected ? 'Live' : 'Reconnecting…'} · {me.identity.name ?? me.identity.login}
          {!me.capabilities.privateApi && (
            <span className="muted" title="Tapbacks, reply-in-thread and mark-as-read need the Private API (see README)">
              {' '}
              · limited
            </span>
          )}
          {'Notification' in window && Notification.permission === 'default' && (
            <button className="link" onClick={() => void Notification.requestPermission()}>
              enable notifications
            </button>
          )}
        </footer>
      </aside>
      <main className="main">
        {selected ? (
          <Conversation
            key={selected.id}
            chat={selected}
            me={me}
            onBack={() => setMobileShowChat(false)}
            notify={notify}
            registerIncoming={(fn) => {
              incomingRef.current = fn;
            }}
          />
        ) : (
          <div className="centered muted">Select a conversation</div>
        )}
      </main>
      {showNew && (
        <NewMessageDialog
          me={me}
          onClose={() => setShowNew(false)}
          onSent={() => {
            setShowNew(false);
            setTimeout(() => void loadChats(), 1500);
          }}
          notify={notify}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
