import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Menangkap error render supaya aplikasi tidak pernah lagi menjadi HALAMAN
 * KOSONG.
 *
 * Ini bukan hiasan. React membongkar seluruh pohon komponen saat ada render
 * yang melempar, dan hasilnya layar putih tanpa satu pun petunjuk — operator
 * hanya tahu "rusak", tidak tahu apa, di mana, atau apakah datanya aman.
 * Persis itu yang terjadi saat satu entri array validasi tertinggal dan
 * seluruh form Add Channel lenyap.
 *
 * Batasnya jujur: `componentDidCatch` TIDAK menangkap error di event handler,
 * kode async, atau saat SSR. Untuk itu tetap perlu try/catch di tempatnya —
 * lihat CredentialsStep dan AuthGate.
 */
interface State {
  error: Error | null;
  info: string | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Dicatat utuh ke konsol supaya jejak komponennya bisa dibaca; yang
    // ditampilkan di layar sengaja lebih ringkas.
    console.error("Render error:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-bg-0 font-ui px-6">
        <div className="max-w-[560px] w-full">
          <div className="text-sm text-danger-text mb-1.5">Layar ini gagal dirender</div>
          <div className="text-xs text-text-muted mb-4">
            Data Anda tidak terpengaruh — kegagalan ini murni di sisi tampilan. Muat ulang untuk
            kembali; kalau berulang, isi kotak di bawah adalah yang dibutuhkan untuk memperbaikinya.
          </div>

          <pre className="text-xs font-mono p-3 rounded-md border border-border bg-surface-1 text-text-secondary overflow-auto max-h-64 whitespace-pre-wrap">
            {error.message}
            {info ? `\n${info.trim().split("\n").slice(0, 8).join("\n")}` : ""}
          </pre>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => this.setState({ error: null, info: null })}
              className="px-4 py-2 text-sm rounded-md border border-border text-text-primary transition-fast hover:bg-overlay"
            >
              Coba render ulang
            </button>
            <button
              onClick={() => location.reload()}
              className="px-4 py-2 text-sm rounded-md transition-fast hover:opacity-90 bg-accent text-bg-0"
            >
              Muat ulang halaman
            </button>
          </div>
        </div>
      </div>
    );
  }
}
