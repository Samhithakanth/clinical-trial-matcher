import { NextResponse, type NextRequest } from "next/server";
import { canAccess, isPublicPath } from "@/lib/access";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Runs before every page and API request (see config.matcher):
//   1. Authentication - a valid signed session cookie is required, except
//      for the login page and login API.
//   2. Authorisation  - the role in the session must be allowed for the
//      path (rules in src/lib/access.ts).
//   3. CSRF           - state-changing API requests must come from this site.
// Pages redirect (to /login or /forbidden); API routes get 401/403 JSON.

const IDENTITY_HEADERS = ["x-user-id", "x-user-name", "x-user-role"];

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  // Browsers send Origin on cross-site POST/PATCH/DELETE; no Origin means a
  // same-origin or non-browser request (e.g. Invoke-RestMethod), which
  // still needs the session cookie.
  return !origin || origin === request.nextUrl.origin;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Never trust identity headers sent by the client.
  const forwarded = new Headers(request.headers);
  IDENTITY_HEADERS.forEach((h) => forwarded.delete(h));

  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request)) {
    return NextResponse.json({ success: false, message: "Cross-site request blocked." }, { status: 403 });
  }

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublicPath(pathname)) {
    // Signed-in users visiting /login go straight to the dashboard.
    if (session && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next({ request: { headers: forwarded } });
  }

  if (!session) {
    if (isApi) {
      return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    const response = NextResponse.redirect(login);
    if (request.cookies.has(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE); // expired/invalid
    return response;
  }

  if (!canAccess(pathname, session.r)) {
    if (isApi) {
      return NextResponse.json(
        { success: false, message: "Your role does not have access to this resource." },
        { status: 403 },
      );
    }
    const forbidden = new URL("/forbidden", request.url);
    forbidden.searchParams.set("from", pathname);
    return NextResponse.redirect(forbidden);
  }

  forwarded.set("x-user-id", String(session.uid));
  forwarded.set("x-user-name", session.u);
  forwarded.set("x-user-role", session.r);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  // Everything except Next.js assets and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)"],
};
