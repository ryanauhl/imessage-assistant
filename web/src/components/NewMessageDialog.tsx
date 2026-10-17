import { useState } from 'react';
import { api, type Me } from '../api';

export function NewMessageDialog({ me, onClose, onSent, notify }: { me: Me; onClose: () => void; onSent: () => void; notify: (m: string) => void }) {
  const [to, setTo] = useState('');
  const [service, setService] = useState<'iMessage' | 'SMS'>('iMessage');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const addresses = to.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const isGroup = addresses.length > 1;

  const submit = async () => {
    if (!addresses.length || !text.trim()) return;
    setBusy(true);
    try {
      await api.newMessage(addresses, service, text.trim());
      onSent();
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
          To <span className="muted small">(phone or email; comma-separate for a group)</span>
          <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="+1 555 123 4567, name@example.com" />
        </label>
        <label>
          Service
          <select value={service} onChange={(e) => setService(e.target.value as 'iMessage' | 'SMS')}>
            <option value="iMessage">iMessage</option>
            <option value="SMS">SMS / Text Message Forwarding</option>
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
