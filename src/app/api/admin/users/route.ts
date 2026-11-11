import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import pool from "@/lib/db";
import { isRole } from "@/lib/access";
import { hashPassword, passwordProblem } from "@/lib/password";
import { getCurrentUser, logAuthEvent } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Middleware already limits /api/admin to ADMIN; this re-checks against
// the database so a demoted or disabled admin is refused immediately.
async function requireAdmin(request: NextRequest) {
  const user = await getCurrentUser(request);
  return user?.role === "ADMIN" ? user : null;
}

// GET /api/admin/users -> all web app accounts (never the password hash)
export async function GET(request: NextRequest) {
  try {
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ success: false, message: "Administrator access required." }, { status: 403 });
    }
    const [users] = await pool.query<RowDataPacket[]>(
      `SELECT account_id, username, display_name, role, is_active, failed_attempts,
              locked_until IS NOT NULL AND locked_until > NOW() AS is_locked,
              last_login_at, created_at
         FROM app_account ORDER BY account_id`,
    );
    return NextResponse.json({
      success: true,
      users: users.map((u) => ({ ...u, is_active: !!u.is_active, is_locked: Number(u.is_locked) === 1 })),
    });
  } catch (error) {
    console.error("List users error:", error);
    return NextResponse.json({ success: false, message: "Unable to load accounts." }, { status: 500 });
  }
}

// POST /api/admin/users  { username, display_name, role, password }
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) {
      return NextResponse.json({ success: false, message: "Administrator access required." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const username = String(body.username ?? "").trim().toLowerCase();
    const displayName = String(body.display_name ?? "").trim();
    const role = body.role;
    const password = String(body.password ?? "");

    if (!/^[a-z0-9_.-]{3,50}$/.test(username)) {
      return NextResponse.json(
        { success: false, message: "Username must be 3–50 characters: lowercase letters, numbers, _ . -" },
        { status: 400 },
      );
    }
    if (!displayName || displayName.length > 100) {
      return NextResponse.json({ success: false, message: "Display name is required (max 100 characters)." }, { status: 400 });
    }
    if (!isRole(role)) {
      return NextResponse.json({ success: false, message: "Choose a valid role." }, { status: 400 });
    }
    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ success: false, message: problem }, { status: 400 });

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO app_account (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`,
      [username, displayName, await hashPassword(password), role],
    );
    await logAuthEvent(request, {
      accountId: result.insertId,
      username,
      type: "ACCOUNT_CHANGED",
      detail: `created as ${role} by ${admin.username}`,
    });
    return NextResponse.json({ success: true, account_id: result.insertId }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json({ success: false, message: "That username is already taken." }, { status: 409 });
    }
    console.error("Create user error:", error);
    return NextResponse.json({ success: false, message: "Unable to create account." }, { status: 500 });
  }
}
