import "server-only";

/**
 * Write access to the person's Google Calendar, through Google's own sign-in (separate from the
 * app's Supabase sign-in). The only permission asked for is `calendar.app.created`: the app may make
 * calendars of its own and manage events in those, and cannot see or touch any other calendar.
 * The long-lived login (refresh token) is kept encrypted in Secrets.gcal; short access tokens are
 * cached in memory only.
 */

export const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const CALENDAR_NAME = "Where MyLife";
/** Cookie that ties Google's answer to the browser that asked. */
export const STATE_COOKIE = "wml_gcal_state";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const API = "https://www.googleapis.com/calendar/v3";

export class GcalError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function client() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new GcalError("Google Calendar is not set up on this server yet: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing.", 503);
  return { id, secret };
}

export const redirectUri = (origin: string) => `${origin}/api/gcal/callback`;

/** Where to send the browser to ask Google for calendar access. */
export function authUrl(origin: string, state: string, email?: string) {
  const q = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GCAL_SCOPE,
    access_type: "offline", // a refresh token, so syncing keeps working without the person
    prompt: "consent", // Google only hands out a refresh token on a consent screen
    include_granted_scopes: "false",
    state,
  });
  if (email) q.set("login_hint", email);
  return `${AUTH_URL}?${q}`;
}

async function token(body: Record<string, string>) {
  const { id, secret } = client();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !d.access_token) {
    // invalid_grant = the person removed access in their Google account, or the login expired
    if (d.error === "invalid_grant") throw new GcalError("Google no longer accepts this connection. Connect Google Calendar again in Settings.", 401);
    throw new GcalError(`Google refused: ${d.error_description || d.error || res.status}`, 502);
  }
  return d as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

/** Trade the code Google sent back for tokens. Insists on the calendar permission being granted. */
export async function exchangeCode(origin: string, code: string) {
  const t = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!t.scope?.split(" ").includes(GCAL_SCOPE)) throw new GcalError("Calendar access was not granted. Connect again and tick the calendar box on Google's screen.");
  if (!t.refresh_token) throw new GcalError("Google did not hand out a lasting login. Remove Where MyLife at myaccount.google.com/permissions, then connect again.");
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in ?? 3600 };
}

const cache = new Map<string, { token: string; until: number }>();

/** A working access token for this refresh token, refreshed when close to expiry. */
export async function accessToken(refreshToken: string) {
  const hit = cache.get(refreshToken);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  cache.set(refreshToken, { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 120) * 1000 });
  return t.access_token;
}

export function primeToken(refreshToken: string, access: string, expiresIn: number) {
  cache.set(refreshToken, { token: access, until: Date.now() + (expiresIn - 120) * 1000 });
}

/** Call the Calendar API. Returns null for 404/410 (gone), throws GcalError otherwise. */
export async function gapi<T>(access: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404 || res.status === 410) return null;
  if (res.status === 204) return {} as T;
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (d as { error?: { message?: string } }).error?.message ?? String(res.status);
    throw new GcalError(`Google Calendar: ${msg}`, res.status === 401 || res.status === 403 ? 401 : 502);
  }
  return d as T;
}

/** The app's own calendar: reuse the saved one if it still exists, otherwise make a new one. */
export async function ensureCalendar(access: string, timeZone: string, existingId?: string) {
  if (existingId && (await gapi(access, `/calendars/${encodeURIComponent(existingId)}`))) return existingId;
  const made = await gapi<{ id: string }>(access, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: CALENDAR_NAME, description: "Study sessions planned by Where MyLife. Changed by the app; edits made here are replaced.", timeZone }),
  });
  if (!made?.id) throw new GcalError("Google did not create the calendar. Try again.", 502);
  return made.id;
}

/** Withdraw the app's access in the person's Google account. Best effort. */
export async function revoke(refreshToken: string) {
  cache.delete(refreshToken);
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: "POST", signal: AbortSignal.timeout(10000) }).catch(() => undefined);
}
