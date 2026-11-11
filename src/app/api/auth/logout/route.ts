import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { logAuthEvent } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/logout -> clears the session cookie.
export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) await logAuthEvent(request, { accountId: session.uid, username: session.u, type: "LOGOUT" });

  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
