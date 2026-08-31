/**
 * Sesi login — disimpan di KV, dirujuk lewat cookie bertanda-tangan.
 *
 * Disimpan server-side (bukan JWT berisi klaim) supaya logout benar-benar
 * mencabut akses seketika. JWT tidak bisa dicabut sebelum kedaluwarsa tanpa
 * daftar-hitam, yang ujungnya tetap butuh KV — jadi langsung saja pakai KV.
 */
import type { Context, MiddlewareHandler } from "hono";
import { createSessionToken, readSessionToken } from "./crypto";
import type { Env } from "../index";

const COOKIE_NAME = "ty_session";
const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 hari

export interface SessionData {
  userId: string;
  username: string;
  createdAt: string;
}

function kvKey(id: string): string {
  return `session:${id}`;
}

function requireSecret(env: Env): string {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    // Gagal keras, bukan diam-diam pakai nilai default: sesi yang ditandatangani
    // secret kosong bisa dipalsukan siapa saja.
    throw new Error("SESSION_SECRET belum diset. Jalankan: wrangler secret put SESSION_SECRET");
  }
  return secret;
}

export async function startSession(
  env: Env,
  data: Omit<SessionData, "createdAt">,
): Promise<string> {
  const { id, token } = await createSessionToken(requireSecret(env));
  const payload: SessionData = { ...data, createdAt: new Date().toISOString() };
  await env.SESSIONS.put(kvKey(id), JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
  return token;
}

export async function readSession(env: Env, token: string): Promise<SessionData | null> {
  const id = await readSessionToken(token, requireSecret(env));
  if (!id) return null; // tanda tangan tidak sah — tidak perlu menyentuh KV
  const raw = await env.SESSIONS.get(kvKey(id));
  return raw ? (JSON.parse(raw) as SessionData) : null;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  const id = await readSessionToken(token, requireSecret(env));
  if (id) await env.SESSIONS.delete(kvKey(id));
}

export function sessionCookie(token: string, url: URL): string {
  // Secure dilewati di localhost saja — browser menolak cookie Secure lewat
  // http://, yang akan membuat dev lokal mustahil login.
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${TTL_SECONDS}`;
}

export function clearCookie(url: URL): string {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

export function readCookie(c: Context): string | null {
  const header = c.req.header("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Menutup seluruh route yang dipasangi. Sesi yang lolos ditaruh di context
 * supaya handler tidak perlu membacanya ulang.
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Env;
  Variables: { session: SessionData };
}> = async (c, next) => {
  const token = readCookie(c);
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const session = await readSession(c.env, token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  c.set("session", session);
  await next();
};

export { COOKIE_NAME, TTL_SECONDS };
