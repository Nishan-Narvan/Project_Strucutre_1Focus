import { NextResponse } from "next/server";

/** Shared by the server routes that call out to addresses the person typed in. */

const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

/**
 * Accept only public https addresses, so these routes cannot be pointed at
 * the server's own machine or a private network.
 */
export function publicHttpsUrl(raw: unknown): URL | null {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:" || PRIVATE_HOST.test(u.hostname) || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
