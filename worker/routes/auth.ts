/**
 * Route autentikasi (PRD §7.1). Satu operator, satu baris `users`.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { hashPassword, verifyPassword } from "../lib/crypto";
import {
  clearCookie,
  destroySession,
  readCookie,
  requireAuth,
  sessionCookie,
  startSession,
  type SessionData,
} from "../lib/session";
import type { Env } from "../index";

type Vars = { Variables: { session: SessionData }; Bindings: Env };

export const auth = new Hono<Vars>();

/**
 * Kegagalan login sengaja diperlambat sedikit dan pesannya dibuat seragam:
 * "username tidak ada" dan "password salah" tidak boleh bisa dibedakan, karena
 * bedanya memberi tahu penyerang mana yang sudah benar.
 */
const GENERIC_FAILURE = { error: "Username atau password salah." } as const;

auth.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => null);
  const username = body?.username?.trim();
  const password = body?.password;

  if (!username || !password) {
    return c.json({ error: "Username dan password wajib diisi." }, 400);
  }

  const db = drizzle(c.env.DB);
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  // Tetap jalankan verifikasi walau user tidak ada, dengan hash boneka, supaya
  // waktu responsnya tidak membocorkan keberadaan username.
  let ok: boolean;
  try {
    ok = user
      ? await verifyPassword(password, user.passwordHash, user.passwordSalt)
      : await verifyPassword(
          password,
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          "AAAAAAAAAAAAAAAAAAAAAA==",
        );
  } catch (err) {
    // Kegagalan kripto BUKAN kredensial salah. Dilaporkan sebagai 500 dan
    // dicatat, supaya tidak menyamar sebagai password keliru dan menyesatkan
    // penelusuran selama berjam-jam.
    console.error("verifyPassword gagal:", err);
    return c.json({ error: "Verifikasi password gagal di server." }, 500);
  }

  if (!user || !ok) return c.json(GENERIC_FAILURE, 401);

  const token = await startSession(c.env, { userId: user.id, username: user.username });
  c.header("Set-Cookie", sessionCookie(token, new URL(c.req.url)));
  return c.json({ ok: true, user: { id: user.id, username: user.username } });
});

auth.post("/logout", async (c) => {
  const token = readCookie(c);
  if (token) await destroySession(c.env, token);
  c.header("Set-Cookie", clearCookie(new URL(c.req.url)));
  return c.json({ ok: true });
});

/** Dipakai aplikasi saat boot untuk memutuskan tampilkan Login atau dashboard. */
auth.get("/me", requireAuth, (c) => {
  const session = c.get("session");
  return c.json({ user: { id: session.userId, username: session.username } });
});

auth.post("/change-password", requireAuth, async (c) => {
  const body = await c.req
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => null);
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;

  if (!currentPassword || !newPassword) {
    return c.json({ error: "Password lama dan baru wajib diisi." }, 400);
  }
  if (newPassword.length < 8) {
    return c.json({ error: "Password baru minimal 8 karakter." }, 400);
  }

  const db = drizzle(c.env.DB);
  const session = c.get("session");
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return c.json({ error: "User tidak ditemukan." }, 404);

  if (!(await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt))) {
    return c.json({ error: "Password lama salah." }, 401);
  }

  const { hash, salt } = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: hash, passwordSalt: salt })
    .where(eq(users.id, user.id));

  // Sesi yang sedang berjalan sengaja TIDAK dicabut: operatornya satu orang,
  // dan memaksa login ulang setelah ganti password sendiri hanya merepotkan.
  return c.json({ ok: true });
});
