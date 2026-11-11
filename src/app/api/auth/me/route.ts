import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-server";
import { SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/me -> the signed-in user. Also checks the database, so a
// disabled account or a changed role ends the session here.
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      const response = NextResponse.json({ success: false, message: "Session ended. Please sign in again." }, { status: 401 });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json({ success: false, message: "Unable to check session." }, { status: 500 });
  }
}
