import { useState } from "react";
import { useApp } from "../store/AppStore";
import { ApiError, authApi } from "../lib/api";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1">
      <div className="px-5 py-4 border-b border-border">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="text-xs mt-0.5 text-text-muted">{subtitle}</div>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm text-text-secondary">{label}</div>
        {hint && <div className="text-xs mt-0.5 text-text-muted">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`relative w-9 h-5 rounded-full border transition-fast ${
          on ? "bg-accent/20 border-accent" : "bg-surface-2 border-border"
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
            on ? "bg-accent" : "bg-text-muted"
          }`}
          style={{ left: on ? "calc(100% - 18px)" : "2px" }}
        />
      </button>
      <span className={`font-mono text-xs w-8 ${on ? "text-accent" : "text-text-muted"}`}>
        {on ? "ON" : "OFF"}
      </span>
    </div>
  );
}

function StatusChip({ label, tone = "success" }: { label: string; tone?: "success" | "muted" }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface-2 text-xs ${
        tone === "success" ? "text-success" : "text-text-muted"
      }`}
    >
      <span className={`status-dot ${tone === "success" ? "active" : "draft"}`} />
      {label}
    </div>
  );
}

const controlClass =
  "px-3 py-2 rounded-md border border-border bg-surface-2 text-text-primary text-sm outline-none";

/**
 * Ganti password operator.
 *
 * Password lama tetap diminta walau sesinya sudah sah — supaya perangkat yang
 * ditinggalkan terbuka tidak bisa dipakai mengunci pemiliknya sendiri keluar.
 * Panjang minimum divalidasi ulang di server; yang di sini hanya agar
 * operator tidak perlu menunggu satu putaran jaringan untuk tahu.
 */
function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "error"; message?: string }>({
    kind: "idle",
  });

  const canSubmit = current.length > 0 && next.length >= 8 && state.kind !== "busy";

  async function submit() {
    setState({ kind: "busy" });
    try {
      await authApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      setState({ kind: "ok", message: "Password diperbarui." });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Gagal mengganti password.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Password lama"
        autoComplete="current-password"
        className={`${controlClass} w-56`}
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="Password baru (min. 8)"
        autoComplete="new-password"
        className={`${controlClass} w-56`}
      />
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="px-3 py-2 text-sm rounded-md transition-fast hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-bg-0"
      >
        {state.kind === "busy" ? "Menyimpan…" : "Ganti password"}
      </button>
      {state.message && (
        <div
          role="status"
          className={`text-xs ${state.kind === "ok" ? "text-success" : "text-danger-text"}`}
        >
          {state.message}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { dryRun, setDryRun, settings, updateSettings, resetDemoData, channels, videos } = useApp();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      <div className="px-8 py-6 max-w-[820px] space-y-4">
        <div className="mb-6">
          <h1 className="text-xl font-medium text-text-primary">Settings</h1>
          <div className="text-sm mt-0.5 text-text-muted">
            Global defaults applied across every channel
          </div>
        </div>

        <Section title="Operator" subtitle="Single-operator console — no other accounts exist">
          <Row label="Signed in as">
            <span className="font-mono text-sm text-text-secondary">operator</span>
          </Row>
          <Row label="Session" hint="Handled by the platform access layer in front of the app">
            <StatusChip label="Authenticated" />
          </Row>
        </Section>

        <Section title="Automation" subtitle="The brakes on full-auto publishing (PRD F11)">
          <Row
            label="Dry-run mode"
            hint="Runs generate, slotting, and storage — but never pushes to Zernio. This is the same switch shown in the sidebar."
          >
            <Toggle on={dryRun} onChange={setDryRun} label="Global dry-run mode" />
          </Row>
          {!dryRun && (
            <div className="p-3 rounded-md border border-danger/20 bg-danger/8 text-xs text-danger-subtle">
              Live mode. Scheduled posts will be pushed to Zernio and published on the channel.
            </div>
          )}
        </Section>

        <Section
          title="AI Defaults"
          subtitle="Baseline for new channels — each channel can override these"
        >
          <Row label="Output language">
            <select
              value={settings.aiOutputLang}
              onChange={(e) => updateSettings({ aiOutputLang: e.target.value })}
              className={controlClass}
            >
              {["Bahasa Indonesia", "Bahasa Malaysia", "English", "Mixed (ID/EN)"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Row>
          <Row label="Tone">
            <select
              value={settings.aiTone}
              onChange={(e) => updateSettings({ aiTone: e.target.value })}
              className={controlClass}
            >
              {[
                "Conversational & Friendly",
                "Professional & Authoritative",
                "Casual & Relatable",
                "Educational & Clear",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Row>
          <div>
            <label className="label-caps block mb-1.5" htmlFor="prompt">
              System Prompt Template
            </label>
            <textarea
              id="prompt"
              value={settings.aiPromptTemplate}
              onChange={(e) => updateSettings({ aiPromptTemplate: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 rounded-md border border-border bg-surface-2 text-text-secondary text-xs outline-none resize-none leading-relaxed"
            />
            <div className="text-xs mt-1 text-text-muted">
              Placeholders <span className="font-mono">{"{{contentType}}"}</span> and{" "}
              <span className="font-mono">{"{{market}}"}</span> are filled per video.
            </div>
          </div>
        </Section>

        <Section title="Notifications" subtitle="Which events reach you outside the console">
          <Row label="Delivery channel" hint="Configured on the platform side, not stored here">
            <StatusChip label="Telegram · Connected" />
          </Row>
          <Row label="Post failed" hint="Recommended — failures are the whole reason to look">
            <Toggle
              on={settings.notifyOnFailure}
              onChange={(v) => updateSettings({ notifyOnFailure: v })}
              label="Notify on failure"
            />
          </Row>
          <Row label="Post published">
            <Toggle
              on={settings.notifyOnPublish}
              onChange={(v) => updateSettings({ notifyOnPublish: v })}
              label="Notify on publish"
            />
          </Row>
          <Row label="Cron missed" hint="Dead-man's-switch — alerts if the daily job never ran">
            <Toggle
              on={settings.notifyOnCronMiss}
              onChange={(v) => updateSettings({ notifyOnCronMiss: v })}
              label="Notify on missed cron"
            />
          </Row>
        </Section>

        <Section
          title="Integrations"
          subtitle="Read-only status — credentials live in platform secrets"
        >
          <div className="flex flex-wrap gap-2">
            <StatusChip label="YouTube · Connected" />
            <StatusChip label="Zernio · Connected" />
            <StatusChip label="Storage (R2) · Connected" />
            <StatusChip label="Cloudflare Images · Not configured" tone="muted" />
          </div>
          <div className="text-xs text-text-muted">
            Thumbnail transformation is still an open decision (PRD §12), so Images is unwired.
          </div>
        </Section>

        <Section title="Akun operator" subtitle="Kredensial login ke konsol ini">
          <Row
            label="Ganti password"
            hint="Minimal 8 karakter. Sesi yang sedang berjalan tidak diputus."
          >
            <ChangePassword />
          </Row>
        </Section>

        <div className="rounded-lg border border-danger/20 bg-surface-1">
          <div className="px-5 py-4 border-b border-danger/20">
            <div className="text-sm font-medium text-danger-text">Danger Zone</div>
            <div className="text-xs mt-0.5 text-text-muted">
              Destructive actions on prototype data
            </div>
          </div>
          <div className="px-5 py-5">
            <Row
              label="Muat ulang dari server"
              hint={`Membuang cache dan menarik ulang ${channels.length} channel dan ${videos.length} video dari D1. Tidak menghapus apa pun.`}
            >
              {confirmReset ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      resetDemoData();
                      setConfirmReset(false);
                    }}
                    className="px-3 py-2 text-sm rounded-md transition-fast hover:opacity-90 bg-danger text-bg-0"
                  >
                    Confirm reset
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="px-3 py-2 text-sm rounded-md border border-border text-text-secondary transition-fast hover:bg-overlay"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="px-3 py-2 text-sm rounded-md border border-danger/40 text-danger-text transition-fast hover:bg-overlay"
                >
                  Reset data
                </button>
              )}
            </Row>
          </div>
        </div>
      </div>
    </div>
  );
}
