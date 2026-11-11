'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_LINKS, ROLE_LABELS, canAccess } from '@/lib/access';
import { signOut, useCurrentUser } from '@/components/useCurrentUser';

export default function Sidebar() {
  const path = usePathname();
  const { user, loading } = useCurrentUser();

  // Session ended (expired, disabled or role changed): back to sign-in.
  useEffect(() => {
    if (!loading && !user && path !== '/login') {
      window.location.assign(`/login?next=${encodeURIComponent(path)}`);
    }
  }, [loading, user, path]);

  if (path === '/login') return null;

  // Show only the pages this role may open (middleware enforces it anyway).
  const links = user ? NAV_LINKS.filter((l) => canAccess(l.href, user.role)) : [];

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">Trial<span>Match</span></Link>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="side-foot">
        {user && (
          <div className="user-chip">
            <div className="avatar" aria-hidden>{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <div className="user-name">{user.name}</div>
              <div className="user-role">{ROLE_LABELS[user.role]}</div>
            </div>
          </div>
        )}
        {user && (
          <button className="btn ghost wide" onClick={signOut}>
            Sign out
          </button>
        )}
        <div className="side-note">Clinical Trial Matcher<br />MySQL · Next.js</div>
      </div>
    </aside>
  );
}
