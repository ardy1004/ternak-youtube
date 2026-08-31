/**
 * Membuat / mengganti akun operator.
 *
 * Password TIDAK diterima lewat argumen CLI — argumen tersimpan di riwayat
 * shell dan terlihat di daftar proses. Skrip ini membacanya dari .dev.vars
 * (sudah di-gitignore), lalu menghitung PBKDF2 dengan parameter yang PERSIS
 * sama dengan worker/lib/crypto.ts. Kalau salah satu berubah, keduanya harus
 * berubah bersamaan — kalau tidak, hash yang tersimpan tidak akan pernah cocok.
 *
 *   node worker/db/create-user.mjs           # ke D1 lokal
 *   node worker/db/create-user.mjs --remote  # ke D1 produksi
 *
 * Butuh di .dev.vars:  BOOTSTRAP_USERNAME=...  BOOTSTRAP_PASSWORD=...
 */
import { webcrypto as crypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Harus identik dengan worker/lib/crypto.ts — termasuk batas 100.000 yang
// dipaksakan runtime Workers (lihat komentar di sana).
const PBKDF2_ITERATIONS = 100_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const remote = process.argv.includes("--remote");

function readDevVars() {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(ROOT, ".dev.vars"), "utf8");
  } catch {
    console.error(".dev.vars tidak ditemukan.");
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const vars = readDevVars();
const username = vars.BOOTSTRAP_USERNAME;
const password = vars.BOOTSTRAP_PASSWORD;

if (!username || !password) {
  console.error("BUTUH di .dev.vars: BOOTSTRAP_USERNAME dan BOOTSTRAP_PASSWORD");
  console.error("Isi dulu, lalu jalankan ulang. Jangan tempelkan nilainya ke chat.");
  process.exit(1);
}

const b64 = (buf) => Buffer.from(buf).toString("base64");

const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
  key,
  KEY_BITS,
);

const id = `usr_${b64(crypto.getRandomValues(new Uint8Array(9))).replace(/[+/=]/g, "").slice(0, 12)}`;
const hash = b64(bits);
const saltB64 = b64(salt);
const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Escape kutip tunggal untuk SQL. Semua nilai di sini base64/ISO/username, jadi
// tidak ada karakter aneh — tapi username datang dari input manusia.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// UPSERT: menjalankan ulang skrip ini mengganti password, bukan gagal karena
// username sudah dipakai.
const sql = `
INSERT INTO users (id, username, password_hash, password_salt, created_at)
VALUES (${q(id)}, ${q(username)}, ${q(hash)}, ${q(saltB64)}, ${q(nowIso)})
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;
`.trim();

const args = [
  "d1",
  "execute",
  "ternak-youtube",
  remote ? "--remote" : "--local",
  "--command",
  sql,
];

try {
  // Entry JS-nya langsung, bukan node_modules/.bin/wrangler(.cmd): di Windows,
  // spawn sebuah .cmd tanpa shell gagal dengan EINVAL, dan menyalakan shell
  // berarti SQL di bawah harus lolos aturan quoting cmd.exe juga.
  const cli = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  execFileSync(process.execPath, [cli, ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  console.log(`Akun operator disimpan ke D1 ${remote ? "PRODUKSI" : "lokal"}.`);
  console.log(`  username   : ${username}`);
  console.log(`  password   : (tidak ditampilkan — ada di .dev.vars)`);
  console.log(`  iterasi    : ${PBKDF2_ITERATIONS.toLocaleString("id-ID")} PBKDF2-SHA256`);
} catch (err) {
  console.error("Gagal menulis ke D1:");
  console.error(err.stderr?.toString() ?? err.message);
  process.exit(1);
}
