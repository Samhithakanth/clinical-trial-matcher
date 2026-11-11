'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';

// Only allow redirects to pages on this site (blocks open redirects like //evil.com).
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'Sign-in failed.');
      // Full navigation so the sidebar and every page load with the new session.
      window.location.assign(safeNext());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setPassword('');
      setSubmitting(false);
    }
  }

  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand login-brand">Trial<span>Match</span></div>
        <div className="eyebrow">SECURE WORKSPACE</div>
        <h1 className="login-title">Sign in</h1>
        <p className="sub">Clinical trial matching and audit ledger. Access depends on your role.</p>

        <form onSubmit={submit} className="form" noValidate>
          <label className="field">
            <span>Username</span>
            <input
              className="input"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="password-row">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={checkCaps}
                onKeyDown={checkCaps}
                disabled={submitting}
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {capsLock && <small className="hint warn-text">Caps Lock is on</small>}
          </label>

          {error && <div className="error" role="alert">{error}</div>}

          <button className="btn primary wide" type="submit" disabled={submitting || !username || !password}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="login-foot">
          Accounts are created by an administrator. 5 failed attempts lock an account for 15 minutes.
        </p>
      </div>
    </div>
  );
}
