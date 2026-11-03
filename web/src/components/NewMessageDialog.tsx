import { useEffect, useState } from 'react';
import { api, type Me } from '../api';
import { RecipientPicker, type Recipient } from './RecipientPicker';

export function NewMessageDialog({ me, onClose, onSent, notify }: { me: Me; onClose: () => void; onSent: (chatId?: number) => void; notify: (m: string) => void }) {
  const [to, setTo] = useState<Recipient[]>([]);
  const [service, setService] = useState<'iMessage' | 'SMS' | 'RCS'>('iMessage');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const addresses = to.map((r) => r.address);
  const isGroup = addresses.length > 1;

  // Escape closes the dialog. The recipient typeahead swallows Escape while its suggestion
  // list is open, so the first press dismisses the list and the second closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!addresses.length || !text.trim()) return;
    setBusy(true);
    try {
      const r = await api.newMessage(addresses, service, text.trim());
      onSent(r.chatId);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New message</h2>
        <label>
          To <span className="muted small">(search contacts; add several for a group)</span>
          <RecipientPicker value={to} onChange={setTo} autoFocus />
        </label>
        <label>
          Service
          <select value={service} onChange={(e) => setService(e.target.value as 'iMessage' | 'SMS' | 'RCS')}>
            <option value="iMessage">iMessage</option>
            <option value="SMS">SMS / Text Message Forwarding</option>
            <option value="RCS">RCS</option>
          </select>
        </label>
        {isGroup && !me.capabilities.groupManage && (
          <p className="error small">Creating a new group needs the Private API. Start the group from your iPhone or Messages.app once and it will appear here.</p>
        )}
        <label>
          Message
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void submit())} />
        </label>
        <div className="row right">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !addresses.length || !text.trim() || (isGroup && !me.capabilities.groupManage)} onClick={() => void submit()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
