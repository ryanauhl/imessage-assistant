import { useState } from 'react';
import { api } from '../api';

export function Login({ needToken, message, onLoggedIn }: { needToken: boolean; message: string; onLoggedIn: () => void }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!needToken) {
    return (
      <div className="centered">
        <div className="card">
          <h2>Access denied</h2>
          <p>{message}</p>
          <p className="muted">Open this through your Tailscale or Cloudflare Access URL with an allowed account.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="centered">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.login(token);
            onLoggedIn();
          } catch (e2) {
            setErr((e2 as Error).message);
          }
        }}
      >
        <h2>Enter app token</h2>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="APP_TOKEN" autoFocus />
        {err && <p className="error">{err}</p>}
        <button type="submit" className="primary">
          Continue
        </button>
      </form>
    </div>
  );
}
