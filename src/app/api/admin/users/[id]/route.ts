import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { isRole } from "@/lib/access";
import { hashPassword, passwordProblem } from "@/lib/password";
import { getCurrentUser, logAuthEvent } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/admin/users/5
//   { role }            change role (ends that user's current sessions)
//   { is_active }       enable / disable (disable ends sessions)
//   { unlock: true }    clear a lockout after failed logins
//   { password }        set a new password (ends sessions)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getCurrentUser(request);
    if (admin?.role !== "ADMIN") {
      return NextResponse.json({ success: false, message: "Administrator access required." }, { status: 403 });
    }

    const accountId = Number((await params).id);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid account id." }, { status: 400 });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT account_id, username, role, is_active FROM app_account WHERE account_id = ?`,
      [accountId],
    );
    const target = rows[0];
    if (!target) return NextResponse.json({ success: false, message: "Account not found." }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const isSelf = accountId === admin.id;
    const sets: string[] = [];
    const values: unknown[] = [];
    const changes: string[] = [];
    let endSessions = false;

    if (body.role !== undefined) {
      if (!isRole(body.role)) return NextResponse.json({ success: false, message: "Invalid role." }, { status: 400 });
      if (isSelf && body.role !== "ADMIN") {
        return NextResponse.json({ success: false, message: "You cannot remove your own administrator role." }, { status: 400 });
      }
      sets.push("role = ?");
      values.push(body.role);
      changes.push(`role ${target.role} -> ${body.role}`);
      endSessions = true;
    }

    if (body.is_active !== undefined) {
      if (isSelf && !body.is_active) {
        return NextResponse.json({ success: false, message: "You cannot disable your own account." }, { status: 400 });
      }
      sets.push("is_active = ?");
      values.push(!!body.is_active);
      changes.push(body.is_active ? "enabled" : "disabled");
      if (!body.is_active) endSessions = true;
    }

    if (body.unlock) {
      sets.push("failed_attempts = 0", "locked_until = NULL");
      changes.push("unlocked");
    }

    if (body.password !== undefined) {
      const problem = passwordProblem(String(body.password));
      if (problem) return NextResponse.json({ success: false, message: problem }, { status: 400 });
      sets.push("password_hash = ?");
      values.push(await hashPassword(String(body.password)));
      changes.push("password reset");
      endSessions = true;
    }

    if (!sets.length) return NextResponse.json({ success: false, message: "Nothing to change." }, { status: 400 });

    // The last active admin must stay an active admin.
    if (target.role === "ADMIN" && (body.role && body.role !== "ADMIN" || body.is_active === false)) {
      const [admins] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM app_account WHERE role = 'ADMIN' AND is_active = TRUE AND account_id <> ?`,
        [accountId],
      );
      if (Number(admins[0].n) === 0) {
        return NextResponse.json({ success: false, message: "At least one active administrator is required." }, { status: 400 });
      }
    }

    if (endSessions) sets.push("session_version = session_version + 1");
    await pool.query(`UPDATE app_account SET ${sets.join(", ")} WHERE account_id = ?`, [...values, accountId]);
    await logAuthEvent(request, {
      accountId,
      username: target.username,
      type: "ACCOUNT_CHANGED",
      detail: `${changes.join(", ")} by ${admin.username}`.slice(0, 255),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json({ success: false, message: "Unable to update account." }, { status: 500 });
  }
}
