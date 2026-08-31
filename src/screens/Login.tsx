import { useState, type FormEvent } from "react";
import { ApiError, authApi, type AuthUser } from "../lib/api";
import { VAR } from "../lib/tokens";

/**
 * Gerbang login (PRD §7.1).
 *
 * Sengaja tidak membedakan "username tidak ada" dari "password salah" — server
 * mengembalikan pesan yang sama untuk keduanya, dan layar ini meneruskannya apa
 * adanya. Membedakannya di UI akan membatalkan perlindungan itu.
 */
export default function Login({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { user } = await authApi.login(username, password);
      onSuccess(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login gagal.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  return (
    <div className="flex h-full items-center justify-center bg-bg-0 font-ui px-6">
      <div className="w-full max-w-[340px]">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-medium bg-accent text-bg-0">
            TY
          </div>
          <div>
            <div className="text-sm text-text-primary">Ternak Youtube</div>
            <div className="text-xs text-text-muted">Content scheduling console</div>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="label-caps block mb-1.5" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={busy}
              className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-fast"
              style={{
                background: VAR.surface1,
                borderColor: VAR.border,
                color: VAR.textPrimary,
              }}
            />
          </div>

          <div>
            <label className="label-caps block mb-1.5" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
              className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-fast"
              style={{
                background: VAR.surface1,
                borderColor: error ? VAR.danger : VAR.border,
                color: VAR.textPrimary,
              }}
            />
          </div>

          {/* role=alert supaya pembaca layar mengumumkan kegagalan, bukan
              hanya menampilkannya. */}
          {error && (
            <div role="alert" className="text-xs text-danger-text">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-bg-0"
          >
            {busy ? "Memeriksa…" : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
