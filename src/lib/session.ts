// Signed session cookie (HMAC-SHA256), verified with the Web Crypto API
// so the same code runs in middleware (Edge) and in route handlers (Node).
//
// Cookie value: base64url(JSON payload) + "." + base64url(signature).
// The cookie is HttpOnly, so page scripts cannot read or steal it.

import { isRole, type Role } from "./access";

export const SESSION_COOKIE = "tm_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // one working shift

export type Session = {
  uid: number; // app_account.account_id
  u: string; // username
  n: string; // display name
  r: Role;
  v: number; // app_account.session_version at sign-in
  exp: number; // unix seconds
};

const encoder = new TextEncoder();

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace_with")) {
    throw new Error("SESSION_SECRET must be set in .env.local to a random value of at least 32 characters.");
  }
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(getSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return keyPromise;
}

export async function createSessionToken(data: Omit<Session, "exp">): Promise<string> {
  const payload: Session = { ...data, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await getKey(), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the session if the signature is valid and it has not expired. */
export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  try {
    // crypto.subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getKey(),
      // Fresh, exactly-sized array, so its buffer holds only the signature.
      fromBase64Url(signature).buffer as ArrayBuffer,
      encoder.encode(body),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Session;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.uid !== "number" || !isRole(payload.r)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
