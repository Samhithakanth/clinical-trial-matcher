import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { isRole } from "@/lib/access";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { logAuthEvent } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// One message for every failure, so the response never reveals whether
// the username exists.
const INVALID = "Invalid username or password.";

// POST /api/auth/login  { username, password }
export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || username.length > 50 || password.length > 200) {
    return NextResponse.json({ success: false, message: INVALID }, { status: 401 });
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT account_id, username, display_name, password_hash, role, is_active,
              failed_attempts, session_version,
              locked_until IS NOT NULL AND locked_until > NOW() AS is_locked
         FROM app_account WHERE username = ?`,
      [username],
    );
    const account = rows[0];

    // Always run the hash check, even for unknown users (constant timing).
    const passwordOk = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);

    if (!account) {
      await logAuthEvent(request, { accountId: null, username, type: "LOGIN_FAILURE", detail: "unknown username" });
      return NextResponse.json({ success: false, message: INVALID }, { status: 401 });
    }

    if (!account.is_active || Number(account.is_locked) === 1) {
      await logAuthEvent(request, {
        accountId: account.account_id,
        username,
        type: "LOGIN_BLOCKED",
        detail: !account.is_active ? "account disabled" : "account locked",
      });
      const message = !account.is_active
        ? "This account is disabled. Contact an administrator."
        : `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or ask an administrator to unlock the account.`;
      return NextResponse.json({ success: false, message }, { status: 423 });
    }

    if (!passwordOk) {
      const attempts = Number(account.failed_attempts) + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await pool.query(
        `UPDATE app_account
            SET failed_attempts = ?,
                locked_until = IF(?, NOW() + INTERVAL ${LOCK_MINUTES} MINUTE, locked_until)
          WHERE account_id = ?`,
        [lock ? 0 : attempts, lock, account.account_id],
      );
      await logAuthEvent(request, {
        accountId: account.account_id,
        username,
        type: lock ? "ACCOUNT_LOCKED" : "LOGIN_FAILURE",
        detail: lock ? `locked after ${MAX_FAILED_ATTEMPTS} failed attempts` : `failed attempt ${attempts}`,
      });
      return NextResponse.json({ success: false, message: INVALID }, { status: 401 });
    }

    if (!isRole(account.role)) {
      return NextResponse.json({ success: false, message: "Account has no valid role." }, { status: 403 });
    }

    await pool.query(
      `UPDATE app_account SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW()
        WHERE account_id = ?`,
      [account.account_id],
    );
    await logAuthEvent(request, { accountId: account.account_id, username, type: "LOGIN_SUCCESS" });

    const token = await createSessionToken({
      uid: account.account_id,
      u: account.username,
      n: account.display_name,
      r: account.role,
      v: Number(account.session_version),
    });

    const response = NextResponse.json({
      success: true,
      user: { username: account.username, name: account.display_name, role: account.role },
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, message: "Sign-in is unavailable. Check the database connection and that sql/003_auth.sql has been run." },
      { status: 500 },
    );
  }
}
