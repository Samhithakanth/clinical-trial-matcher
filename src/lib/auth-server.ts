import type { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { isRole, type Role } from "@/lib/access";
import { SESSION_COOKIE, verifySessionToken, type Session } from "@/lib/session";

// Server-side helpers for route handlers. Middleware already blocks
// requests the user's role may not make; these give handlers the
// current user and a second, database-backed check for sensitive actions.

export type CurrentUser = { id: number; username: string; name: string; role: Role };

/** Verifies the session cookie and that the account is still active with the same role. */
export async function getCurrentUser(request: NextRequest): Promise<CurrentUser | null> {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return checkAccount(session);
}

export async function checkAccount(session: Session): Promise<CurrentUser | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT account_id, username, display_name, role, is_active, session_version
       FROM app_account WHERE account_id = ?`,
    [session.uid],
  );
  const a = rows[0];
  if (!a || !a.is_active || Number(a.session_version) !== session.v || !isRole(a.role)) return null;
  return { id: a.account_id, username: a.username, name: a.display_name, role: a.role };
}

/** Role of the signed-in user as verified by middleware (set on the forwarded request). */
export function roleFromHeaders(request: Request): Role | null {
  const role = request.headers.get("x-user-role");
  return isRole(role) ? role : null;
}

export function clientInfo(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: (forwarded || request.headers.get("x-real-ip") || "").slice(0, 45) || null,
    userAgent: (request.headers.get("user-agent") || "").slice(0, 255) || null,
  };
}

export async function logAuthEvent(
  request: NextRequest,
  event: {
    accountId: number | null;
    username: string;
    type: "LOGIN_SUCCESS" | "LOGIN_FAILURE" | "ACCOUNT_LOCKED" | "LOGIN_BLOCKED" | "LOGOUT" | "ACCOUNT_CHANGED";
    detail?: string;
  },
) {
  const { ip, userAgent } = clientInfo(request);
  try {
    await pool.query(
      `INSERT INTO auth_event (account_id, username, event_type, detail, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [event.accountId, event.username.slice(0, 50), event.type, event.detail ?? null, ip, userAgent],
    );
  } catch (error) {
    // Never block sign-in because the event log is unavailable.
    console.error("auth_event insert failed:", error);
  }
}
