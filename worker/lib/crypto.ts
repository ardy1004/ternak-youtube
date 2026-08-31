/**
 * Primitif kripto — hanya Web Crypto, tanpa dependensi.
 *
 * bcrypt/argon2 butuh WASM di Workers; PBKDF2 tersedia native lewat SubtleCrypto
 * dan berjalan di kode terkompilasi, bukan JS, jadi cukup cepat untuk endpoint
 * login tanpa menyentuh batas CPU.
 */

/**
 * BATAS PLATFORM, bukan pilihan: Cloudflare Workers menolak iterasi di atas
 * 100.000 dengan `NotSupportedError: Pbkdf2 failed: iteration counts above
 * 100000 are not supported`. Jangan dinaikkan — OWASP memang menyarankan
 * >=600k, tapi angka itu ditolak runtime.
 *
 * Yang bikin ini mahal untuk ditemukan: `wrangler dev` lokal TIDAK menegakkan
 * batasnya, jadi 600k berjalan mulus di dev dan baru gagal di produksi.
 *
 * Nilai ini HARUS sama persis dengan worker/db/create-user.mjs. Kalau berbeda,
 * hash yang dibuat skrip itu tidak akan pernah cocok saat login.
 */
const PBKDF2_ITERATIONS = 100_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Perbandingan waktu-konstan. Workers tidak menyediakan `timingSafeEqual`, dan
 * `===` pada string keluar lebih cepat saat byte pertama berbeda — cukup untuk
 * membocorkan hash byte demi byte lewat pengukuran waktu.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt);
  return { hash: toBase64(derived), salt: toBase64(salt) };
}

/**
 * Mengembalikan false HANYA bila passwordnya memang tidak cocok.
 *
 * Versi sebelumnya membungkus seluruh badan fungsi dalam try/catch dan
 * mengembalikan false pada error apa pun. Itu tampak defensif, tapi berakibat
 * setiap kegagalan runtime — kunci rusak, batas platform, bug — menyamar
 * sebagai "password salah". Gejalanya persis kegagalan autentikasi biasa,
 * sehingga penyebab sesungguhnya tidak pernah terlihat.
 *
 * Sekarang hanya data rusak di database yang ditangani; kegagalan kripto
 * dilempar supaya terlihat di log dan menghasilkan 500, bukan 401 palsu.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  let saltBytes: Uint8Array;
  let hashBytes: Uint8Array;
  try {
    saltBytes = fromBase64(salt);
    hashBytes = fromBase64(hash);
  } catch {
    // Baris database rusak — bukan error runtime, dan bukan salah operator.
    return false;
  }

  const derived = await derive(password, saltBytes);
  return constantTimeEqual(derived, hashBytes);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * Token sesi = `<id acak>.<hmac(id)>`.
 *
 * ID-nya sendiri sudah acak 32 byte, jadi HMAC bukan untuk kerahasiaan — ia
 * membuat token palsu bisa ditolak tanpa menyentuh KV sama sekali. Tanpa itu,
 * siapa pun bisa memaksa satu pembacaan KV per request sampah.
 */
export async function createSessionToken(secret: string): Promise<{ id: string; token: string }> {
  const id = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(id));
  return { id, token: `${id}.${toBase64(signature).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}` };
}

/** Mengembalikan id sesi bila tanda tangannya sah, selain itu null. */
export async function readSessionToken(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const expected = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(id));
  const expectedB64 = toBase64(expected).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return constantTimeEqual(encoder.encode(provided), encoder.encode(expectedB64)) ? id : null;
}

/**
 * AES-GCM untuk kunci Zernio per-channel (PRD §10 — terenkripsi at rest di D1).
 * Nonce 12 byte diacak per operasi dan disimpan di depan ciphertext.
 */
export async function encryptSecret(plaintext: string, keyMaterial: string): Promise<string> {
  const key = await aesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return toBase64(packed);
}

export async function decryptSecret(packed: string, keyMaterial: string): Promise<string | null> {
  try {
    const bytes = fromBase64(packed);
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      await aesKey(keyMaterial),
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // Kunci salah atau data rusak. Kembalikan null supaya pemanggil bisa
    // menandai channel butuh kredensial baru, bukan menjatuhkan seluruh cron.
    return null;
  }
}

async function aesKey(keyMaterial: string): Promise<CryptoKey> {
  // Panjang ENCRYPTION_KEY dinormalkan lewat SHA-256, jadi secret sepanjang
  // apa pun tetap menghasilkan kunci AES-256 yang sah.
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(keyMaterial));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
