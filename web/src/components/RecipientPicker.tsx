import { useEffect, useRef, useState } from 'react';
import { api, type ContactHit } from '../api';
import { prettyAddress } from '../util';

export interface Recipient {
  address: string;
  name?: string;
}

interface Props {
  value: Recipient[];
  onChange: (r: Recipient[]) => void;
  autoFocus?: boolean;
}

/** Typeahead over Contacts + people you've messaged. Enter/comma adds; Backspace removes last chip. */
export function RecipientPicker({ value, onChange, autoFocus }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      api.contactSearch(q.trim()).then((h) => {
        setHits(h.filter((x) => !value.some((v) => v.address === x.address)));
        setIdx(0);
        setOpen(true);
      }).catch(() => setHits([]));
    }, 120);
    return () => window.clearTimeout(t);
  }, [q, value]);

  const add = (r: Recipient) => {
    if (!r.address.trim()) return;
    if (!value.some((v) => v.address === r.address)) onChange([...value, r]);
    setQ('');
    setHits([]);
    setOpen(false);
    input.current?.focus();
  };

  const addRaw = () => {
    const raw = q.trim().replace(/,$/, '');
    if (!raw) return;
    if (open && hits[idx]) add({ address: hits[idx].address, name: hits[idx].name || undefined });
    else add({ address: raw });
  };

  return (
    <div className="recipients">
      <div className="chips" onClick={() => input.current?.focus()}>
        {value.map((r) => (
          <span key={r.address} className="chip recipient">
            {r.name ?? prettyAddress(r.address)}
            <button className="link" onClick={() => onChange(value.filter((v) => v.address !== r.address))} aria-label="Remove">
              ✕
            </button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={q}
          placeholder={value.length ? '' : 'Type a name, phone, or email'}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
              if (q.trim()) {
                e.preventDefault();
                addRaw();
              }
            } else if (e.key === 'Backspace' && !q && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open && hits.length > 0 && (
        <ul className="suggestions" role="listbox">
          {hits.map((h, i) => (
            <li
              key={h.address}
              role="option"
              aria-selected={i === idx}
              className={i === idx ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                add({ address: h.address, name: h.name || undefined });
              }}
              onMouseEnter={() => setIdx(i)}
            >
              <span className="s-name">{h.name || prettyAddress(h.address)}</span>
              <span className="muted small">
                {h.name ? prettyAddress(h.address) : ''} {h.source === 'recent' ? `· ${h.service ?? 'recent'}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
