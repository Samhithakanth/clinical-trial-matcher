'use client';

import { useEffect, useState } from 'react';
import type { Role } from '@/lib/access';

export type CurrentUser = { id: number; username: string; name: string; role: Role };

let cached: Promise<CurrentUser | null> | null = null;

function loadUser(): Promise<CurrentUser | null> {
  if (!cached) {
    cached = fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json();
        return r.ok && json.success ? (json.user as CurrentUser) : null;
      })
      .catch(() => null);
  }
  return cached;
}

/** The signed-in user (checked against the database once per page load). */
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    loadUser().then((u) => {
      if (!active) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { user, loading };
}

export async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  cached = null;
  window.location.assign('/login');
}
