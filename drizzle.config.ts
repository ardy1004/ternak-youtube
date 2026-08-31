import { defineConfig } from "drizzle-kit";

/**
 * Hanya untuk MENGHASILKAN SQL migrasi. Penerapannya lewat
 * `wrangler d1 migrations apply`, bukan drizzle-kit — wrangler yang memegang
 * tabel pelacak migrasi milik D1, dan `migrations_dir` di wrangler.jsonc
 * menunjuk ke folder `out` di bawah ini.
 */
export default defineConfig({
  schema: "./worker/db/schema.ts",
  out: "./worker/db/migrations",
  dialect: "sqlite",
});
