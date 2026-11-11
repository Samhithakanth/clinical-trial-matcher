import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { roleFromHeaders } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const [matches] = await pool.query(
      `SELECT mr.match_id, mr.subject_id, p.anchor_age, mr.trial_id, ct.title AS trial_name,
              mr.scalar_score, mr.semantic_score, mr.final_score, mr.eligibility_status, mr.matched_at
         FROM match_result mr
         LEFT JOIN patients p ON p.subject_id = mr.subject_id
         LEFT JOIN clinical_trial ct ON ct.trial_id = mr.trial_id
        ORDER BY mr.matched_at DESC, mr.match_id DESC`,
    );

    // Researchers may see match outcomes but not patient demographics,
    // matching the database-level denial on the patients table.
    const rows = matches as Record<string, unknown>[];
    const visible = roleFromHeaders(request) === 'RESEARCHER'
      ? rows.map((row) => ({ ...row, anchor_age: null }))
      : rows;

    return NextResponse.json({ success: true, total: visible.length, matches: visible });
  } catch (e) {
    console.error('Matches API:', e);
    return NextResponse.json(
      { success: false, message: 'Unable to fetch match results. Check database connection and permissions.' },
      { status: 500 },
    );
  }
}
