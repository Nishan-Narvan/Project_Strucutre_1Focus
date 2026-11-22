import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseEnv } from "./supabase";

/**
 * Google sign-in through Supabase Auth, done entirely on the server. The browser only ever holds
 * httpOnly cookies; no Supabase key reaches it. Flow: /auth/login sends the person to Google via
 * Supabase with a PKCE challenge, /auth/callback trades the code for a session, and every API route
 * calls `currentUser()`, which refreshes an expired session on the way.
 */

const AT = "wml_at";
const RT = "wml_rt";
const PKCE = "wml_pkce";
const NEXT = "wml_next";
const REFRESH_DAYS = 60;

export interface User {
  id: string;
  email: string;
}

interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
}

const b64url = (b: Buffer) => b.toString("base64url");
const secure = () => process.env.NODE_ENV === "production";

async function gotrue(path: string, init: RequestInit = {}, accessToken?: string) {
  const { url, key } = supabaseEnv();
  return fetch(`${url}/auth/v1/${path}`, {
    ...init,
    headers: { apikey: key, "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
}

async function setSession(s: Session) {
  const jar = await cookies();
  const base = { httpOnly: true, secure: secure(), sameSite: "lax" as const, path: "/" };
  jar.set(AT, s.access_token, { ...base, maxAge: Math.max(60, s.expires_in - 30) });
  jar.set(RT, s.refresh_token, { ...base, maxAge: REFRESH_DAYS * 86400 });
}

export async function clearSession() {
  const jar = await cookies();
  for (const n of [AT, RT, PKCE, NEXT]) jar.delete(n);
}

/** Start sign-in: returns the URL to send the browser to. */
export async function beginSignIn(origin: string, next = "/goals") {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const jar = await cookies();
  const base = { httpOnly: true, secure: secure(), sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set(PKCE, verifier, base);
  jar.set(NEXT, next.startsWith("/") && !next.startsWith("//") ? next : "/goals", base);
  const { url } = supabaseEnv();
  const q = new URLSearchParams({ provider: "google", redirect_to: `${origin}/auth/callback`, code_challenge: challenge, code_challenge_method: "s256" });
  return `${url}/auth/v1/authorize?${q}`;
}

/** Finish sign-in with the code Supabase sent back. Returns where to go next. */
export async function finishSignIn(code: string): Promise<string> {
  const jar = await cookies();
  const verifier = jar.get(PKCE)?.value;
  const next = jar.get(NEXT)?.value ?? "/goals";
  if (!verifier) throw new Error("The sign-in took too long or was started in another browser. Try again.");
  const res = await gotrue("token?grant_type=pkce", { method: "POST", body: JSON.stringify({ auth_code: code, code_verifier: verifier }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || "Supabase did not accept the sign-in.");
  await setSession(data as Session);
  jar.delete(PKCE);
  jar.delete(NEXT);
  return next;
}

/** Sign-in with a password. Only for automated tests, and only when the test switch is on. */
export async function passwordSignIn(email: string, password: string) {
  const res = await gotrue("token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || "Sign-in failed.");
  await setSession(data as Session);
}

/**
 * Local development only: sign in as the account in WML_DEV_LOGIN without Google, so the app can be
 * tried on localhost (Supabase sends Google sign-ins back to the deployed address). Uses the admin API
 * to make a one-time link for that email and redeems it at once. The route that calls this refuses to
 * run in production or from anywhere but localhost.
 */
export async function devSignIn(email: string) {
  const link = await gotrue("admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) }, supabaseEnv().key);
  const made = await link.json().catch(() => ({}));
  const token = made.hashed_token ?? made.properties?.hashed_token;
  if (!link.ok || !token) throw new Error(made.msg || made.error_description || "Could not make a sign-in link for that email.");
  const res = await gotrue("verify", { method: "POST", body: JSON.stringify({ type: "magiclink", token_hash: token }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.msg || data.error_description || "Supabase did not accept the local sign-in.");
  await setSession(data as Session);
}

// A verified access token is trusted for a minute, so each request does not cost a round trip
const verified = new Map<string, { user: User; until: number }>();

async function userFromToken(token: string): Promise<User | null> {
  const hit = verified.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await gotrue("user", {}, token);
  if (!res.ok) return null;
  const u = (await res.json()) as { id: string; email?: string };
  const user = { id: u.id, email: u.email ?? "" };
  if (verified.size > 500) verified.clear();
  verified.set(token, { user, until: Date.now() + 60000 });
  return user;
}

/** The signed-in user, or null. Refreshes an expired session (only route handlers can save the new cookies). */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const at = jar.get(AT)?.value;
  if (at) {
    const u = await userFromToken(at);
    if (u) return u;
  }
  const rt = jar.get(RT)?.value;
  if (!rt) return null;
  const res = await gotrue("token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: rt }) });
  if (!res.ok) return null;
  const s = (await res.json()) as Session;
  try {
    await setSession(s);
  } catch {
    // Not in a route handler: the session still works for this request
  }
  return { id: s.user.id, email: s.user.email ?? "" };
}

export async function signOut() {
  const jar = await cookies();
  const at = jar.get(AT)?.value;
  if (at) await gotrue("logout", { method: "POST" }, at).catch(() => null);
  await clearSession();
}
