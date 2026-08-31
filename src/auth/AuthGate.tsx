import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, authApi, type AuthUser } from "../lib/api";
import Login from "../screens/Login";

interface AuthState {
  user: AuthUser;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth dipakai di luar AuthGate.");
  return ctx;
}

/**
 * Memutuskan antara layar login dan aplikasi, dengan menanyakan server —
 * bukan dengan membaca cookie.
 *
 * Cookie sesinya HttpOnly, jadi JavaScript memang tidak bisa melihatnya. Itu
 * bukan halangan, justru benar: satu-satunya sumber kebenaran soal "sesi ini
 * masih sah" ada di server, dan menebaknya di klien hanya menghasilkan UI yang
 * mengaku login padahal setiap permintaan akan 401.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [offline, setOffline] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user } = await authApi.me();
        if (!cancelled) setUser(user);
      } catch (err) {
        // 401 itu wajar — artinya belum login. Selain itu berarti server
        // bermasalah, dan menampilkan form login akan menyesatkan.
        if (!cancelled && err instanceof ApiError && !err.isUnauthorized) {
          setOffline(err.message);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Tetap keluar walau panggilan logout gagal: menahan operator di dalam
      // aplikasi karena jaringan bermasalah lebih buruk daripada sesi server
      // yang baru dibersihkan saat TTL-nya habis.
      setUser(null);
    }
  }, []);

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-0 font-ui">
        <div className="w-[220px] flex flex-col gap-2">
          <div className="skeleton h-3 rounded" />
          <div className="skeleton h-3 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (offline) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-0 font-ui px-6">
        <div className="max-w-[340px] text-center">
          <div className="text-sm text-text-primary mb-1.5">Server tidak bisa dihubungi</div>
          <div className="text-xs text-text-muted mb-4">{offline}</div>
          <button
            onClick={() => location.reload()}
            className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 bg-accent text-bg-0"
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (!user) return <Login onSuccess={setUser} />;

  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}
