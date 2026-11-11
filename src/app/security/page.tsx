'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import PageHeader from '@/components/PageHeader';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/access';
import { useCurrentUser } from '@/components/useCurrentUser';

type Account = {
  account_id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  is_locked: boolean;
  failed_attempts: number;
  last_login_at: string | null;
};

type AuthEvent = {
  event_id: number;
  username: string;
  event_type: string;
  detail: string | null;
  ip_address: string | null;
  created_at: string;
};

const EVENT_STYLE: Record<string, string> = {
  LOGIN_SUCCESS: 'good',
  LOGOUT: '',
  ACCOUNT_CHANGED: '',
  LOGIN_FAILURE: 'warn',
  LOGIN_BLOCKED: 'bad',
  ACCOUNT_LOCKED: 'bad',
};

const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : 'Never');

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.message || 'Request failed.');
  return json;
}

export default function SecurityPage() {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION / SECURITY"
        title="Access & Security"
        subtitle={isAdmin ? 'Manage who can sign in and review sign-in activity.' : 'Review sign-in activity across the workspace.'}
      />
      {user?.role === 'ADMIN' && <AccountsPanel currentUserId={user.id} />}
      <EventsPanel />
    </>
  );
}

function AccountsPanel({ currentUserId }: { currentUserId: number }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const json = await api('/api/admin/users');
      setAccounts(json.users);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(account: Account, change: Record<string, unknown>, message: string) {
    setBusyId(account.account_id);
    setNotice('');
    setError('');
    try {
      await api(`/api/admin/users/${account.account_id}`, { method: 'PATCH', body: JSON.stringify(change) });
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function resetPassword(account: Account) {
    const password = window.prompt(`New password for ${account.username} (min 10 characters, letters and numbers):`);
    if (password) update(account, { password }, `Password reset for ${account.username}. Their current sessions were ended.`);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Accounts</h2>
        <button className="btn primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Close' : '+ New account'}
        </button>
      </div>

      {showForm && (
        <CreateAccountForm
          onCreated={async (name) => {
            setShowForm(false);
            setNotice(`Account ${name} created.`);
            await load();
          }}
        />
      )}
      {error && <div className="error inset">{error}</div>}
      {notice && <div className="notice inset">{notice}</div>}

      {loading ? (
        <div className="loading">Loading accounts…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const self = a.account_id === currentUserId;
                const busy = busyId === a.account_id;
                return (
                  <tr key={a.account_id}>
                    <td>
                      <div className="strong">{a.display_name}{self && <span className="muted"> (you)</span>}</div>
                      <div className="muted small">{a.username}</div>
                    </td>
                    <td>
                      <select
                        className="search compact"
                        value={a.role}
                        disabled={self || busy}
                        onChange={(e) =>
                          update(a, { role: e.target.value }, `${a.username} is now ${ROLE_LABELS[e.target.value as Role]}. Their current sessions were ended.`)
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${!a.is_active ? 'bad' : a.is_locked ? 'warn' : 'good'}`}>
                        {!a.is_active ? 'DISABLED' : a.is_locked ? 'LOCKED' : 'ACTIVE'}
                      </span>
                    </td>
                    <td className="muted">{fmtTime(a.last_login_at)}</td>
                    <td>
                      <div className="actions">
                        {a.is_locked && (
                          <button className="btn ghost" disabled={busy} onClick={() => update(a, { unlock: true }, `${a.username} unlocked.`)}>
                            Unlock
                          </button>
                        )}
                        <button className="btn ghost" disabled={busy} onClick={() => resetPassword(a)}>
                          Reset password
                        </button>
                        {!self && (
                          <button
                            className={`btn ${a.is_active ? 'danger' : 'ghost'}`}
                            disabled={busy}
                            onClick={() =>
                              update(a, { is_active: !a.is_active }, a.is_active ? `${a.username} disabled and signed out.` : `${a.username} enabled.`)
                            }
                          >
                            {a.is_active ? 'Disable' : 'Enable'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CreateAccountForm({ onCreated }: { onCreated: (username: string) => void }) {
  const [form, setForm] = useState({ username: '', display_name: '', role: 'CLINICIAN' as Role, password: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
      onCreated(form.username.trim().toLowerCase());
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="form inline-form" onSubmit={submit}>
      <label className="field">
        <span>Username</span>
        <input className="input" value={form.username} onChange={set('username')} placeholder="e.g. dr.rao" required />
      </label>
      <label className="field">
        <span>Display name</span>
        <input className="input" value={form.display_name} onChange={set('display_name')} placeholder="Dr. Anjali Rao" required />
      </label>
      <label className="field">
        <span>Role</span>
        <select className="input" value={form.role} onChange={set('role')}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Temporary password</span>
        <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="10+ chars, letters and numbers" required />
      </label>
      <button className="btn primary" disabled={saving}>{saving ? 'Creating…' : 'Create account'}</button>
      {error && <div className="error full">{error}</div>}
    </form>
  );
}

function EventsPanel() {
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [last24h, setLast24h] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api(filter ? `/api/security/events?type=${filter}` : '/api/security/events')
      .then((json) => {
        setEvents(json.events);
        setLast24h(json.last24h);
        setError('');
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filter]);

  const shown = useMemo(
    () => events.filter((e) => `${e.username} ${e.detail || ''} ${e.ip_address || ''}`.toLowerCase().includes(query.toLowerCase())),
    [events, query],
  );

  const cards: Array<[string, string]> = [
    ['LOGIN_SUCCESS', 'Successful sign-ins'],
    ['LOGIN_FAILURE', 'Failed sign-ins'],
    ['ACCOUNT_LOCKED', 'Accounts locked'],
    ['LOGIN_BLOCKED', 'Blocked attempts'],
  ];

  return (
    <>
      <div className="grid section-gap">
        {cards.map(([type, label]) => (
          <button
            key={type}
            className={`card card-button ${filter === type ? 'selected' : ''}`}
            onClick={() => setFilter(filter === type ? '' : type)}
            title="Click to filter the table"
          >
            <div className="metric-label">{label}</div>
            <div className="metric-value">{last24h[type] ?? 0}</div>
            <div className="metric-note">Last 24 hours</div>
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Sign-in activity{filter && <span className="muted"> · {filter.replaceAll('_', ' ')}</span>}</h2>
          <input className="search" placeholder="Search user, detail, IP…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {error && <div className="error inset">{error}</div>}
        {loading ? (
          <div className="loading">Loading activity…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Event</th>
                  <th>Detail</th>
                  <th>IP address</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.event_id}>
                    <td className="muted">{fmtTime(e.created_at)}</td>
                    <td>{e.username}</td>
                    <td><span className={`badge ${EVENT_STYLE[e.event_type] ?? ''}`}>{e.event_type.replaceAll('_', ' ')}</span></td>
                    <td className="muted">{e.detail || '—'}</td>
                    <td className="muted">{e.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <div className="empty">No sign-in events found.</div>}
          </div>
        )}
      </section>
    </>
  );
}
