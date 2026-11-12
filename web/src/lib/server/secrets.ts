import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { loadSecretBlob, saveSecretBlob } from "./supabase";
import type { ProviderId } from "@/lib/types";

/**
 * A user's secrets (model API key, MCP connection tokens, connector token), encrypted with
 * AES-256-GCM using WML_ENCRYPTION_KEY before they reach the database. The database alone,
 * or a leaked backup of it, cannot reveal them.
 */

export interface Secrets {
  model?: { provider: ProviderId; apiKey: string; baseUrl?: string };
  /** MCP connection id -> bearer token */
  mcp?: Record<string, string>;
  /** The claude.ai connector token, kept so the URL can be shown again */
  connector?: string;
}

function key() {
  const raw = process.env.WML_ENCRYPTION_KEY?.trim();
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new Error("WML_ENCRYPTION_KEY is missing or not 32 bytes of base64. Keys cannot be saved until it is set.");
  return k;
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}

export function decrypt(blob: string) {
  const [v, iv, tag, body] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable secret.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

export async function loadSecrets(userId: string): Promise<Secrets> {
  const blob = await loadSecretBlob(userId);
  return blob ? (JSON.parse(decrypt(blob)) as Secrets) : {};
}

export async function updateSecrets(userId: string, fn: (s: Secrets) => Secrets) {
  const next = fn(await loadSecrets(userId));
  await saveSecretBlob(userId, encrypt(JSON.stringify(next)));
  return next;
}
