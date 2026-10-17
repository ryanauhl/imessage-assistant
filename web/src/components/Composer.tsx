import { useEffect, useRef, useState } from 'react';
import type { Message } from '@shared/types';
import { api } from '../api';
import { cleanText, prettyAddress } from '../util';

interface Props {
  chatId: number;
  replyTo: Message | null;
  canReply: boolean;
  canType: boolean;
  onCancelReply: () => void;
  onSend: (text: string, files: File[]) => Promise<void>;
  notify: (m: string) => void;
}

export function Composer({ chatId, replyTo, canReply, canType, onCancelReply, onSend, notify }: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);

  useEffect(() => {
    ta.current?.focus();
  }, [chatId, replyTo]);

  useEffect(() => {
    if (!canType) return;
    if (!text) return;
    void api.typing(chatId, true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => void api.typing(chatId, false), 4000);
  }, [text, chatId, canType]);

  const submit = async () => {
    if (busy || (!text.trim() && files.length === 0)) return;
    setBusy(true);
    try {
      await onSend(text.trim(), files);
      setText('');
      setFiles([]);
      if (canType) void api.typing(chatId, false);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      ta.current?.focus();
    }
  };

  return (
    <div className="composer" onPaste={(e) => {
      const pasted = Array.from(e.clipboardData.files ?? []);
      if (pasted.length) setFiles((f) => [...f, ...pasted]);
    }}>
      {replyTo && canReply && (
        <div className="reply-banner">
          <span className="muted small">Replying to {replyTo.fromMe ? 'yourself' : (replyTo.senderName ?? prettyAddress(replyTo.sender ?? ''))}:</span>{' '}
          <span className="small">{cleanText(replyTo.text).slice(0, 80) || 'Attachment'}</span>
          <button className="link" onClick={onCancelReply}>
            ✕
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="file-chips">
          {files.map((f, i) => (
            <span key={i} className="chip">
              {f.name}
              <button className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <label className="icon-btn" title="Attach file">
          +
          <input type="file" multiple hidden onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
        </label>
        <textarea
          ref={ta}
          rows={1}
          placeholder={replyTo && canReply ? 'Reply in thread…' : 'iMessage'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') onCancelReply();
          }}
          disabled={busy}
        />
        <button className="send" onClick={() => void submit()} disabled={busy || (!text.trim() && files.length === 0)} title="Send">
          {busy ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
}
