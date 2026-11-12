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

const urlFor = (req: Request, token: string) => `${new URL(req.url).origin}/api/connector/${token}/mcp`;

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
