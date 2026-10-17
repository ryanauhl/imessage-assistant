import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatSummary, Message } from '@shared/types';
import { api, ApiError, connectWs, type Me } from './api';
import { ChatList } from './components/ChatList';
import { Conversation } from './components/Conversation';
import { NewMessageDialog } from './components/NewMessageDialog';
import { Login } from './components/Login';
import { SearchResults } from './components/SearchResults';
import { usePins } from './pins';
import { currentSubscription, disablePush, enablePush, pushSupported, setBadge } from './push';

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
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const pushOnRef = useRef(false);
  const { pins, isPinned, toggle: togglePin } = usePins();
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
      setBadge(m.totalUnread);
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
    if (pushSupported()) {
      currentSubscription().then((sub) => {
        const on = !!sub && Notification.permission === 'granted';
        pushOnRef.current = on;
        setPushOn(on);
      });
    } else setPushOn(false);
    // Notification click → open that chat
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'open-chat') {
        setSelectedId(Number(e.data.chatId));
        setMobileShowChat(true);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [loadMe]);

  const togglePush = async () => {
    try {
      if (pushOnRef.current) {
        await disablePush();
        pushOnRef.current = false;
        setPushOn(false);
      } else {
        const ok = await enablePush();
        pushOnRef.current = ok;
        setPushOn(ok);
        if (!ok) notify('Notifications were not allowed by the browser');
      }
    } catch (e) {
      notify((e as Error).message);
    }
  };

  useEffect(() => {
    if (!me) return;
    void loadChats();
    const stop = connectWs(
      (ev) => {
        if (ev.type === 'hello') return;
        document.title = ev.totalUnread ? `(${ev.totalUnread}) Messages` : 'Messages';
        setBadge(ev.totalUnread);
        incomingRef.current(ev.newMessages, ev.chatIds);
        // debounce list refresh (read receipts, previews, unread counts)
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void loadChats(), 300);
        const inbound = ev.newMessages.filter((m) => !m.fromMe && m.itemType === 0);
        if (inbound.length && !pushOnRef.current && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
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
  const sortedChats = useMemo(() => {
    const pinned = pins.map((g) => chats.find((c) => c.guid === g)).filter((c): c is ChatSummary => !!c);
    const rest = chats.filter((c) => !pins.includes(c.guid));
    return { pinned, rest };
  }, [chats, pins]);

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
          <ChatList pinned={sortedChats.pinned} chats={sortedChats.rest} selectedId={selectedId} onSelect={openChat} onTogglePin={togglePin} />
        )}
        <footer className="sidebar-foot">
          <span className={`dot ${connected ? 'on' : 'off'}`} /> {connected ? 'Live' : 'Reconnecting…'} · {me.identity.name ?? me.identity.login}
          {!me.capabilities.privateApi && (
            <span className="muted" title="Tapbacks, reply-in-thread and mark-as-read need the Private API (see README)">
              {' '}
              · limited
            </span>
          )}
          {pushOn !== null && pushSupported() && (
            <button className="link" onClick={() => void togglePush()} title="Push notifications to this device, even when the app is closed">
              {pushOn ? 'notifications on' : 'enable notifications'}
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
            pinned={isPinned(selected.guid)}
            onTogglePin={() => togglePin(selected.guid)}
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
          onSent={(chatId) => {
            setShowNew(false);
            if (chatId) openChat(chatId);
            setTimeout(() => void loadChats(), 1500);
          }}
          notify={notify}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
