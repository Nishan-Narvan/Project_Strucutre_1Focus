import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/http";
import { loadSecrets, updateSecrets } from "@/lib/server/secrets";
import { deleteConnectorToken, setConnectorToken } from "@/lib/server/supabase";

export const runtime = "nodejs";

/**
 * The signed-in user's claude.ai connector URL.
 *   GET    -> { url | null }
 *   POST   -> make a new URL (the old one stops working)
 *   DELETE -> turn the connector off
 */

/**
 * The public address of the app, so a URL made while running locally still points at the deployed site:
 * APP_URL if set, else Vercel's production domain, else the address the request came in on.
 */
function appOrigin(req: Request) {
  const set = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (set) return set;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return new URL(req.url).origin;
}

const urlFor = (req: Request, token: string) => `${appOrigin(req)}/api/connector/${token}/mcp`;

export async function GET(req: Request) {
  return withUser(async (user) => {
    const s = await loadSecrets(user.id);
    return NextResponse.json({ url: s.connector ? urlFor(req, s.connector) : null });
  });
}

export async function POST(req: Request) {
  return withUser(async (user) => {
    const token = randomBytes(32).toString("base64url");
    await setConnectorToken(user.id, token);
    await updateSecrets(user.id, (s) => ({ ...s, connector: token }));
    return NextResponse.json({ url: urlFor(req, token) });
  });
}

export async function DELETE() {
  return withUser(async (user) => {
    await deleteConnectorToken(user.id);
    await updateSecrets(user.id, (s) => ({ ...s, connector: undefined }));
    return NextResponse.json({ ok: true });
  });
}
