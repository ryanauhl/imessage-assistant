import { useState } from 'react';
import type { Message, ReactionName } from '@shared/types';
import { attachmentUrl, type Me } from '../api';
import { cleanText, describeSystemMessage, fmtBytes, fmtTime, isServiceSms, prettyAddress, REACTION_EMOJI, senderLabel } from '../util';

interface Props {
  message: Message;
  isGroup: boolean;
  showSender: boolean;
  caps: Me['capabilities'];
  isLast: boolean;
  onReply: () => void;
  onOpenThread: () => void;
  onReact: (r: ReactionName, remove: boolean) => void;
  compact?: boolean;
}

const PICKER: ReactionName[] = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'];

export function MessageBubble({ message: m, showSender, caps, isLast, onReply, onOpenThread, onReact, compact }: Props) {
  const [picker, setPicker] = useState(false);
  const sys = describeSystemMessage(m);
  if (sys) return <div className="sys-msg">{sys}</div>;

  const text = cleanText(m.text);
  const side = m.fromMe ? 'me' : 'them';
  const sms = isServiceSms(m.service);
  const status = !m.fromMe
    ? null
    : m.error
      ? 'Not delivered'
      : m.dateRead
        ? `Read ${fmtTime(m.dateRead)}`
        : m.isDelivered || m.dateDelivered
          ? 'Delivered'
          : m.isSent
            ? 'Sent'
            : 'Sending…';

  return (
    <div className={`msg ${side} ${compact ? 'compact' : ''}`}>
      {showSender && <div className="sender">{senderLabel(m)}</div>}
      <div className="bubble-row">
        <div className="bubble-col">
          {m.replyTo && (
            <button className="quote" onClick={onOpenThread} title="Open thread">
              <span className="muted small">{m.replyTo.fromMe ? 'You' : prettyAddress(m.replyTo.sender ?? '')}</span>
              <span>{cleanText(m.replyTo.text) || 'Attachment'}</span>
            </button>
          )}
          {m.attachments.map((a) => (
            <AttachmentView key={a.id} a={a} side={side} />
          ))}
          {m.balloonBundleId && !text && <div className={`bubble ${side} ${sms ? 'sms' : ''}`}>📎 App message ({m.balloonBundleId.split('.').pop()})</div>}
          {m.isAudioMessage && !m.attachments.length && <div className={`bubble ${side}`}>🎤 Audio message</div>}
          {text && (
            <div className={`bubble ${side} ${sms ? 'sms' : ''}`} title={fmtTime(m.date)}>
              {linkify(text)}
              {m.dateEdited && <span className="edited"> (edited)</span>}
            </div>
          )}
          {m.reactions.length > 0 && (
            <div className={`reactions ${side}`}>
              {m.reactions.map((r, i) => (
                <span key={i} className={`reaction ${r.fromMe ? 'mine' : ''}`} title={r.fromMe ? 'You' : (r.senderName ?? prettyAddress(r.sender ?? ''))}>
                  {REACTION_EMOJI[r.type]}
                </span>
              ))}
            </div>
          )}
          {m.replyCount > 0 && !compact && (
            <button className="link small" onClick={onOpenThread}>
              {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'} ›
            </button>
          )}
        </div>
        <div className="actions">
          <button className="icon-btn tiny" title={caps.tapback ? 'Tapback' : 'Tapbacks need the Private API'} disabled={!caps.tapback} onClick={() => setPicker((p) => !p)}>
            ☺
          </button>
          <button className="icon-btn tiny" title={caps.replyInThread ? 'Reply in thread' : 'Reply-in-thread needs the Private API'} disabled={!caps.replyInThread} onClick={onReply}>
            ↩
          </button>
        </div>
      </div>
      {picker && (
        <div className={`picker ${side}`} onMouseLeave={() => setPicker(false)}>
          {PICKER.map((r) => {
            const mine = m.reactions.some((x) => x.fromMe && x.type === r);
            return (
              <button
                key={r}
                className={mine ? 'active' : ''}
                onClick={() => {
                  onReact(r, mine);
                  setPicker(false);
                }}
              >
                {REACTION_EMOJI[r]}
              </button>
            );
          })}
        </div>
      )}
      {isLast && status && <div className="status muted small">{status}</div>}
    </div>
  );
}

function AttachmentView({ a, side }: { a: Message['attachments'][number]; side: string }) {
  const [broken, setBroken] = useState(false);
  const name = a.transferName ?? a.filename?.split('/').pop() ?? 'file';
  if (broken) {
    return (
      <div className={`bubble ${side} file`} title="File not downloaded on this Mac (open it in Messages.app once)">
        📎 {name} <span className="small">(not available)</span>
      </div>
    );
  }
  if (a.isImage) {
    return (
      <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" className={`att-img ${side}`}>
        <img src={attachmentUrl(a.id, { thumb: true })} alt={name} loading="lazy" onError={() => setBroken(true)} />
      </a>
    );
  }
  if (a.isVideo) {
    return <video className={`att-video ${side}`} controls preload="metadata" src={attachmentUrl(a.id)} />;
  }
  if (a.mimeType?.startsWith('audio/') || /\.(caf|m4a|amr|mp3)$/i.test(name)) {
    return <audio controls preload="none" src={attachmentUrl(a.id)} />;
  }
  return (
    <a className={`bubble ${side} file`} href={attachmentUrl(a.id, { download: true })}>
      📄 {name} <span className="muted small">{fmtBytes(a.totalBytes)}</span>
    </a>
  );
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
