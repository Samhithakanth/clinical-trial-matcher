'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { ROLE_LABELS } from '@/lib/access';
import { useCurrentUser } from '@/components/useCurrentUser';

export default function Forbidden() {
  const { user } = useCurrentUser();
  const [from, setFrom] = useState('');

  useEffect(() => {
    setFrom(new URLSearchParams(window.location.search).get('from') || '');
  }, []);

  return (
    <>
      <PageHeader eyebrow="ACCESS / DENIED" title="Access denied" subtitle="Your role does not include this page." />
      <section className="panel">
        <div className="loading">
          {user ? `Signed in as ${user.name} (${ROLE_LABELS[user.role]}).` : ''}{' '}
          {from && <>You do not have permission to open <code>{from}</code>. </>}
          Ask an administrator if you need access.
          <div style={{ marginTop: 18 }}>
            <Link className="back" href="/">← Back to dashboard</Link>
          </div>
        </div>
      </section>
    </>
  );
}
