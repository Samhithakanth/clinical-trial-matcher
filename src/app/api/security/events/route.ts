import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["LOGIN_SUCCESS", "LOGIN_FAILURE", "ACCOUNT_LOCKED", "LOGIN_BLOCKED", "LOGOUT", "ACCOUNT_CHANGED"];

// GET /api/security/events[?type=LOGIN_FAILURE] -> latest 200 sign-in events.
// Access: ADMIN and COMPLIANCE (enforced by middleware).
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type")?.toUpperCase();
  if (type && !TYPES.includes(type)) {
    return NextResponse.json({ success: false, message: "Invalid event type." }, { status: 400 });
  }

  try {
    const [events] = await pool.query<RowDataPacket[]>(
      `SELECT event_id, username, event_type, detail, ip_address, created_at
         FROM auth_event ${type ? "WHERE event_type = ?" : ""}
        ORDER BY event_id DESC LIMIT 200`,
      type ? [type] : [],
    );
    const [summary] = await pool.query<RowDataPacket[]>(
      `SELECT event_type, COUNT(*) AS n FROM auth_event
        WHERE created_at >= NOW() - INTERVAL 1 DAY GROUP BY event_type`,
    );
    return NextResponse.json({
      success: true,
      events,
      last24h: Object.fromEntries(summary.map((s) => [s.event_type, Number(s.n)])),
    });
  } catch (error) {
    console.error("Security events error:", error);
    return NextResponse.json({ success: false, message: "Unable to load sign-in activity." }, { status: 500 });
  }
}
