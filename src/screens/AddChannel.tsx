import { useMemo, useState } from "react";
import { ApiError, channelsApi, type TestConnectionResult } from "../lib/api";
import { useApp } from "../store/AppStore";
import { VAR } from "../lib/tokens";

interface AddChannelProps {
  onSave: () => void;
  onCancel: () => void;
  /** When set, the form edits that channel instead of creating a new one. */
  editingChannelId?: string | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STEPS = [
  "Identity",
  "Credentials",
  "Targeting",
  "Scheduling",
  "YouTube",
  "AI Settings",
  "Warm-up",
];

interface FormState {
  name: string;
  handle: string;
  isActive: boolean;
  /**
   * Kunci Zernio. HANYA-TULIS: server tidak pernah mengembalikannya, jadi saat
   * mengedit channel field ini selalu mulai kosong. Kosong berarti "jangan
   * ubah", bukan "hapus" — kalau tidak, setiap penyimpanan form biasa akan
   * menghapus kredensial yang tidak ditampilkan.
   */
  zernioApiKey: string;
  zernioAccountId: string;
  /** Jam dasar harian "HH:mm". Semua bergeser serempak tiap hari. */
  baseTimes: string[];
  driftMinutesPerDay: number;
  market: string;
  contentLang: string;
  niche: string;
  contentType: string;
  timezone: string;
  videosPerDay: number;
  maxUploadsPerDay: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  activeDays: string[];
  visibility: string;
  category: string;
  baselineTags: string;
  playlistId: string;
  madeForKids: boolean;
  aiLang: string;
  aiTone: string;
  fewShot: string;
  ctaTemplate: string;
  warmupEnabled: boolean;
  warmupDays: number;
  warmupStartPerDay: number;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="text-sm font-medium text-text-primary">{title}</div>
      {subtitle && <div className="text-xs mt-0.5 text-text-muted">{subtitle}</div>}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div>
      <label className="label-caps block mb-1.5">{label}</label>
      {children}
      {error ? (
        <div className="text-xs mt-1 text-danger-text">{error}</div>
      ) : (
        hint && <div className="text-xs mt-1 text-text-muted">{hint}</div>
      )}
    </div>
  );
}

/**
 * Field colours vary with validation state, so this is the computed-value case
 * from `lib/tokens` — CSS vars rather than Tailwind classes.
 */
function inputStyle(error?: string) {
  return {
    background: VAR.surface2,
    borderColor: error ? VAR.danger : VAR.border,
    color: VAR.textPrimary,
  };
}

function ConnectedChip({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface-2 text-xs ${
        connected ? "text-success" : "text-text-muted"
      }`}
    >
      <span className={`status-dot ${connected ? "active" : "draft"}`} />
      {label}
    </div>
  );
}

/**
 * Kredensial Zernio + uji koneksi sungguhan (PRD §7.3, F1).
 *
 * Dua hal yang membuat langkah ini ada:
 *  - Tanpa field ini, channel yang BERFUNGSI tidak bisa dibuat lewat UI sama
 *    sekali. Prototipe hanya memasang chip "Zernio · Connected" statis, yang
 *    bukan sekadar tidak berguna — ia berbohong.
 *  - `accountId` DIPILIH dari hasil uji, bukan diketik. Ia adalah id internal
 *    Zernio sepanjang 24 hex; mengetiknya manual hampir pasti salah, dan
 *    salahnya baru ketahuan saat post gagal terbit berjam-jam kemudian.
 */
function CredentialsStep({
  channelId,
  apiKey,
  accountId,
  hasStoredKey,
  onApiKey,
  onAccountId,
}: {
  channelId: string | null;
  apiKey: string;
  accountId: string;
  hasStoredKey: boolean;
  onApiKey: (v: string) => void;
  onAccountId: (v: string) => void;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "ok"; accounts: NonNullable<TestConnectionResult["youtube"]>; total: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const canTest = apiKey.trim().length > 0 || (hasStoredKey && Boolean(channelId));

  async function test() {
    setState({ kind: "busy" });
    try {
      // Channel baru belum punya id, jadi kunci dikirim di body. Itu justru
      // intinya: operator harus bisa membuktikan kuncinya benar SEBELUM
      // menyimpannya, bukan sesudah.
      const res = await channelsApi.testConnection(channelId ?? "new", apiKey.trim() || undefined);
      if (!res.ok) {
        setState({ kind: "error", message: res.error ?? "Koneksi ditolak." });
        return;
      }
      const accounts = res.youtube ?? [];
      setState({ kind: "ok", accounts, total: res.total ?? accounts.length });
      // Kalau hanya ada satu channel YouTube, pilihkan — tidak ada yang perlu
      // diputuskan operator di situ.
      if (accounts.length === 1 && accounts[0]) onAccountId(accounts[0].accountId);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Gagal menghubungi server.",
      });
    }
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Kredensial Zernio"
        subtitle="Kunci API dan channel YouTube yang akan dipublish"
      />

      <Field
        label="Zernio API Key"
        hint={
          hasStoredKey
            ? "Sudah tersimpan dan terenkripsi. Kosongkan untuk mempertahankannya; isi hanya bila ingin mengganti."
            : "Diambil dari dashboard Zernio. Disimpan terenkripsi (AES-GCM), tidak pernah ditampilkan kembali."
        }
      >
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKey(e.target.value)}
          placeholder={hasStoredKey ? "•••••••• (tersimpan)" : "sk_…"}
          autoComplete="off"
          spellCheck={false}
          className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-fast font-mono"
          style={inputStyle()}
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          onClick={test}
          disabled={!canTest || state.kind === "busy"}
          className="px-4 py-2 text-sm rounded-md border border-border text-text-primary transition-fast hover:bg-overlay disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {state.kind === "busy" ? "Menguji…" : "Test connection"}
        </button>
        {state.kind === "ok" && (
          <span className="text-xs text-success">
            Terhubung — {state.total} akun, {state.accounts.length} di antaranya YouTube.
          </span>
        )}
        {state.kind === "error" && (
          <span role="alert" className="text-xs text-danger-text">
            {state.message}
          </span>
        )}
      </div>

      {state.kind === "ok" && state.accounts.length > 0 && (
        <Field
          label="Channel YouTube"
          hint="Post akan diterbitkan ke channel yang dipilih di sini."
        >
          <div className="space-y-2">
            {state.accounts.map((a) => (
              <button
                key={a.accountId}
                onClick={() => onAccountId(a.accountId)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md border text-left transition-fast ${
                  accountId === a.accountId
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface-2 hover:bg-overlay"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm text-text-primary truncate">{a.displayName}</div>
                  <div className="text-xs text-text-muted truncate">
                    @{a.username} · {a.isActive ? "aktif" : "tidak aktif"}
                  </div>
                </div>
                {accountId === a.accountId && (
                  <span className="text-xs text-accent flex-shrink-0 ml-3">terpilih</span>
                )}
              </button>
            ))}
          </div>
        </Field>
      )}

      {state.kind === "ok" && state.accounts.length === 0 && (
        <div className="text-xs text-warning">
          Kunci ini sah, tapi tidak ada channel YouTube yang terhubung padanya. Hubungkan dulu di
          dashboard Zernio.
        </div>
      )}

      {accountId && state.kind !== "ok" && (
        <div className="text-xs text-text-muted">
          Account ID tersimpan: <span className="font-mono">{accountId}</span>
        </div>
      )}
    </div>
  );
}

/** Menit "HH:mm" → angka, untuk mengurutkan dan menghitung pergeseran. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Jam dasar harian + pergeseran (menggantikan jendela/interval).
 *
 * Menampilkan pratinjau siklusnya, bukan hanya menerima angka: pola ini
 * bergeser perlahan selama puluhan hari, dan tanpa pratinjau operator tidak
 * punya cara melihat kapan ia mencapai tengah malam dan kembali ke awal.
 */
function BaseTimesField({
  baseTimes,
  drift,
  timezone,
  onBaseTimes,
  onDrift,
}: {
  baseTimes: string[];
  drift: number;
  timezone: string;
  onBaseTimes: (v: string[]) => void;
  onDrift: (v: number) => void;
}) {
  const ordered = [...baseTimes].sort((a, b) => toMinutes(a) - toMinutes(b));
  const latest = ordered.length ? toMinutes(ordered[ordered.length - 1]!) : 0;
  const cycleDays = drift > 0 ? Math.max(1, Math.ceil((1440 - latest) / drift)) : 1;

  const shift = (day: number) =>
    ordered
      .map((t) => {
        const m = toMinutes(t) + day * drift;
        return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      })
      .join("  ");

  const setAt = (i: number, value: string) =>
    onBaseTimes(baseTimes.map((t, n) => (n === i ? value : t)));

  return (
    <div className="space-y-4">
      <Field
        label="Jam dasar harian"
        hint={`Semua jam bergeser serempak +${drift} menit tiap hari, lalu kembali ke jam dasar setelah ${cycleDays} hari (saat jam terakhir menyentuh 00:00). Waktu dalam ${timezone}.`}
      >
        <div className="flex flex-wrap gap-2">
          {baseTimes.map((t, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="time"
                value={t}
                onChange={(e) => setAt(i, e.target.value)}
                className="px-3 py-2 rounded-md border text-sm outline-none font-mono"
                style={inputStyle()}
              />
              <button
                onClick={() => onBaseTimes(baseTimes.filter((_, n) => n !== i))}
                aria-label={`Hapus jam ${t}`}
                className="px-2 py-2 text-xs text-text-muted hover:text-danger-text transition-fast"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => onBaseTimes([...baseTimes, "12:00"])}
            className="px-3 py-2 text-sm rounded-md border border-border text-text-secondary transition-fast hover:bg-overlay"
          >
            + Tambah jam
          </button>
        </div>
      </Field>

      <Field label="Pergeseran per hari (menit)">
        <input
          type="number"
          min={0}
          max={60}
          value={drift}
          onChange={(e) => onDrift(Number(e.target.value))}
          className="w-32 px-3 py-2 rounded-md border text-sm outline-none"
          style={inputStyle()}
        />
      </Field>

      {ordered.length > 0 && (
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <div className="label-caps mb-2">Pratinjau siklus</div>
          <div className="space-y-1 font-mono text-xs text-text-secondary">
            <div>hari 1 · {shift(0)}</div>
            <div>hari 2 · {shift(1)}</div>
            <div className="text-text-muted">…</div>
            <div>
              hari {cycleDays} · {shift(cycleDays - 1)}
            </div>
            <div className="text-accent">hari {cycleDays + 1} · {shift(0)} (kembali ke awal)</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
  onText,
  offText,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  onText: string;
  offText: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`relative w-9 h-5 rounded-full border transition-fast flex-shrink-0 ${
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
      <span className={`text-sm ${on ? "text-accent" : "text-text-muted"}`}>
        {on ? onText : offText}
      </span>
    </div>
  );
}

export default function AddChannel({ onSave, onCancel, editingChannelId }: AddChannelProps) {
  const { addChannel, updateChannel, channelById, settings } = useApp();
  const editing = editingChannelId ? channelById(editingChannelId) : undefined;

  const [currentStep, setCurrentStep] = useState(0);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [form, setForm] = useState<FormState>(() =>
    editing
      ? {
          name: editing.name,
          handle: editing.handle,
          isActive: editing.status === "active",
          // Selalu kosong saat mengedit: server tidak pernah mengirim kunci balik.
          zernioApiKey: "",
          zernioAccountId: (editing as { zernioAccountId?: string }).zernioAccountId ?? "",
          baseTimes: (editing as { baseTimes?: string[] }).baseTimes ?? ["06:00","12:00","17:00","19:00","21:00"],
          driftMinutesPerDay: (editing as { driftMinutesPerDay?: number }).driftMinutesPerDay ?? 5,
          market: editing.market,
          contentLang: editing.contentLang,
          niche: editing.niche,
          contentType: editing.contentType,
          timezone: editing.timezone,
          videosPerDay: editing.videosPerDay,
          maxUploadsPerDay: editing.maxUploadsPerDay,
          windowStart: editing.windowStart,
          windowEnd: editing.windowEnd,
          intervalMin: editing.intervalMin,
          activeDays: editing.activeDays,
          visibility: editing.visibility,
          category: editing.category,
          baselineTags: editing.baselineTags,
          playlistId: editing.playlistId,
          madeForKids: editing.madeForKids,
          aiLang: editing.aiOutputLang,
          aiTone: editing.aiTone,
          fewShot: editing.aiFewShot,
          ctaTemplate: editing.aiCtaTemplate,
          warmupEnabled: editing.warmupEnabled,
          warmupDays: editing.warmupDays,
          warmupStartPerDay: editing.warmupStartPerDay,
        }
      : {
          name: "",
          handle: "",
          isActive: true,
          zernioApiKey: "",
          zernioAccountId: "",
          baseTimes: ["06:00","12:00","17:00","19:00","21:00"],
          driftMinutesPerDay: 5,
          market: "Indonesia",
          contentLang: "id",
          niche: "Technology",
          contentType: "Tutorial",
          timezone: "Asia/Jakarta",
          videosPerDay: 5,
          maxUploadsPerDay: 5,
          windowStart: "07:00",
          windowEnd: "20:00",
          intervalMin: 60,
          activeDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
          visibility: "public",
          category: "Science & Technology",
          baselineTags: "",
          playlistId: "",
          madeForKids: false,
          aiLang: settings.aiOutputLang,
          aiTone: settings.aiTone,
          fewShot: "",
          ctaTemplate: "",
          warmupEnabled: false,
          warmupDays: 14,
          warmupStartPerDay: 1,
        }
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const markTouched = (key: string) => setTouched((prev) => ({ ...prev, [key]: true }));

  /** Live validation — PRD §7.3 asks for real-time field validation. */
  const errors = useMemo(() => {
    const e: Record<string, string> = {};

    if (form.name.trim().length < 2) e.name = "Internal name is required";
    if (!form.handle.trim()) {
      e.handle = "Handle or channel URL is required";
    } else if (!form.handle.startsWith("@") && !form.handle.includes("youtube.com")) {
      e.handle = "Use an @handle or a full youtube.com URL";
    }

    if (form.videosPerDay < 1) e.videosPerDay = "Must publish at least 1 video per day";
    if (form.maxUploadsPerDay < form.videosPerDay) {
      e.maxUploadsPerDay = "Guardrail cannot be lower than videos per day";
    }
    if (form.windowEnd <= form.windowStart) e.windowEnd = "Window must end after it starts";
    if (form.intervalMin < 15) e.intervalMin = "Minimum spacing is 15 minutes";
    if (form.activeDays.length === 0) e.activeDays = "Pick at least one active day";

    // A day must physically fit the requested number of slots.
    const windowMinutes =
      (Number(form.windowEnd.slice(0, 2)) * 60 + Number(form.windowEnd.slice(3))) -
      (Number(form.windowStart.slice(0, 2)) * 60 + Number(form.windowStart.slice(3)));
    if (
      !e.windowEnd &&
      !e.intervalMin &&
      form.videosPerDay > 1 &&
      windowMinutes < (form.videosPerDay - 1) * form.intervalMin
    ) {
      e.intervalMin = `Window fits only ${Math.floor(windowMinutes / form.intervalMin) + 1} slots at this interval`;
    }

    if (form.warmupEnabled && form.warmupStartPerDay > form.videosPerDay) {
      e.warmupStartPerDay = "Warm-up must start below the steady-state rate";
    }

    return e;
  }, [form]);

  /**
   * Field mana yang divalidasi di tiap langkah. Panjangnya HARUS sama dengan
   * STEPS — header stepper melakukan loop atas seluruh STEPS dan mengindeks
   * array ini, jadi satu entri yang kurang membuat seluruh layar blank, bukan
   * sekadar satu langkah rusak.
   *
   * Dikunci ke nama langkah, bukan urutan posisi, supaya menyisipkan langkah
   * baru di tengah tidak diam-diam menggeser validasi ke langkah yang salah —
   * yang persis terjadi saat langkah "Credentials" ditambahkan.
   */
  const FIELDS_BY_STEP: Record<string, string[]> = {
    Identity: ["name", "handle"],
    Credentials: [],
    Targeting: [],
    Scheduling: ["videosPerDay", "maxUploadsPerDay", "windowEnd", "intervalMin", "activeDays"],
    YouTube: [],
    "AI Settings": [],
    "Warm-up": ["warmupStartPerDay"],
  };
  const STEP_FIELDS: string[][] = STEPS.map((s) => FIELDS_BY_STEP[s] ?? []);

  const stepErrors = (STEP_FIELDS[currentStep] ?? []).filter((f) => errors[f]);
  const stepValid = stepErrors.length === 0;
  const formValid = Object.keys(errors).length === 0;

  const showError = (key: string) => (touched[key] ? errors[key] : undefined);

  const toggleDay = (day: string) => {
    markTouched("activeDays");
    set(
      "activeDays",
      form.activeDays.includes(day)
        ? form.activeDays.filter((d) => d !== day)
        : [...form.activeDays, day]
    );
  };

  const handleSave = () => {
    const payload = {
      name: form.name.trim(),
      handle: form.handle.trim(),
      status: (form.isActive ? "active" : "paused") as "active" | "paused",
      market: form.market,
      niche: form.niche,
      contentType: form.contentType,
      contentLang: form.contentLang,
      timezone: form.timezone,
      videosPerDay: form.videosPerDay,
      maxUploadsPerDay: form.maxUploadsPerDay,
      windowStart: form.windowStart,
      windowEnd: form.windowEnd,
      intervalMin: form.intervalMin,
      activeDays: form.activeDays,
      visibility: form.visibility,
      category: form.category,
      baselineTags: form.baselineTags,
      playlistId: form.playlistId,
      madeForKids: form.madeForKids,
      aiOutputLang: form.aiLang,
      aiTone: form.aiTone,
      aiFewShot: form.fewShot,
      aiCtaTemplate: form.ctaTemplate,
      warmupEnabled: form.warmupEnabled,
      warmupDays: form.warmupDays,
      warmupStartPerDay: form.warmupStartPerDay,
      zernioAccountId: form.zernioAccountId,
      baseTimes: form.baseTimes,
      driftMinutesPerDay: form.driftMinutesPerDay,
      // Hanya dikirim bila benar-benar diisi. Kunci kosong berarti "pertahankan
      // yang tersimpan", bukan "hapus" — server memperlakukannya begitu.
      ...(form.zernioApiKey.trim() ? { zernioApiKey: form.zernioApiKey.trim() } : {}),
    };

    if (editing) {
      updateChannel(editing.id, payload);
    } else {
      addChannel({ ...payload, weeklyViews: 0 });
    }
    onSave();
  };

  const goNext = () => {
    (STEP_FIELDS[currentStep] ?? []).forEach(markTouched);
    if (stepValid) setCurrentStep(currentStep + 1);
  };

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      <div className="px-8 py-6 max-w-[820px]">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={onCancel}
            className="text-xs mb-3 flex items-center gap-1 transition-fast hover:opacity-70 text-text-muted"
          >
            ← Channels
          </button>
          <h1 className="text-xl font-medium text-text-primary">
            {editing ? `Edit — ${editing.name}` : "Add Channel"}
          </h1>
          {editing && (
            <div className="text-sm mt-0.5 font-mono text-text-muted">{editing.handle}</div>
          )}
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-8 flex-wrap">
          {STEPS.map((step, i) => {
            const hasError = (STEP_FIELDS[i] ?? []).some((f) => errors[f] && touched[f]);
            const current = i === currentStep;
            const done = i < currentStep;

            const labelTone = hasError
              ? "text-danger-text"
              : current
                ? "text-accent"
                : done
                  ? "text-text-primary"
                  : "text-text-muted";

            const markTone = hasError
              ? "border-danger text-danger-text"
              : current
                ? "border-accent text-accent bg-accent/12"
                : done
                  ? "border-success text-success"
                  : "border-border text-text-muted";

            return (
              <div key={step} className="flex items-center">
                <button
                  onClick={() => setCurrentStep(i)}
                  className={`flex items-center gap-2 text-xs transition-fast ${labelTone}`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-xs border ${markTone}`}
                  >
                    {hasError ? "!" : done ? "✓" : i + 1}
                  </div>
                  {step}
                </button>
                {i < STEPS.length - 1 && <div className="w-6 h-px mx-2 bg-border" />}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="rounded-lg border border-border bg-surface-1 p-6 mb-4">
          {/* Step 0 — Identity */}
          {currentStep === 0 && (
            <div className="space-y-5">
              <SectionHeader title="Identity" subtitle="Basic channel identification and status" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Internal Name" error={showError("name")}>
                  <input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    onBlur={() => markTouched("name")}
                    placeholder="e.g. Tech Indonesia"
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-fast"
                    style={inputStyle(showError("name"))}
                  />
                </Field>
                <Field label="YouTube Handle / URL" error={showError("handle")}>
                  <input
                    value={form.handle}
                    onChange={(e) => set("handle", e.target.value)}
                    onBlur={() => markTouched("handle")}
                    placeholder="@handle or youtube.com/..."
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-fast"
                    style={inputStyle(showError("handle"))}
                  />
                </Field>
              </div>
              <Field label="Status">
                <Toggle
                  on={form.isActive}
                  onChange={(v) => set("isActive", v)}
                  label="Channel active"
                  onText="Active"
                  offText="Paused"
                />
              </Field>
            </div>
          )}

          {/* Step 1 — Credentials */}
          {currentStep === 1 && (
            <CredentialsStep
              channelId={editing?.id ?? null}
              apiKey={form.zernioApiKey}
              accountId={form.zernioAccountId}
              hasStoredKey={Boolean((editing as { hasZernioKey?: boolean } | undefined)?.hasZernioKey)}
              onApiKey={(v) => set("zernioApiKey", v)}
              onAccountId={(v) => set("zernioAccountId", v)}
            />
          )}

          {/* Step 2 — Targeting */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <SectionHeader
                title="Targeting & Content"
                subtitle="Define the audience and content type for this channel"
              />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Target Market">
                  <select
                    value={form.market}
                    onChange={(e) => set("market", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    {["Indonesia", "Malaysia", "International", "Singapore", "Philippines"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Content Language">
                  <select
                    value={form.contentLang}
                    onChange={(e) => set("contentLang", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    <option value="id">Bahasa Indonesia</option>
                    <option value="ms">Bahasa Malaysia</option>
                    <option value="en">English</option>
                    <option value="mixed">Mixed (ID/EN)</option>
                  </select>
                </Field>
                <Field label="Content Niche" hint="Main topic/category for this channel">
                  <select
                    value={form.niche}
                    onChange={(e) => set("niche", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    {["Technology", "Finance", "Food & Lifestyle", "Education", "Crypto", "Health & Fitness", "Business"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      )
                    )}
                  </select>
                </Field>
                <Field label="Content Type">
                  <select
                    value={form.contentType}
                    onChange={(e) => set("contentType", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    {["Tutorial", "Explainer", "Vlog", "Recipe", "Review", "Education"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          )}

          {/* Step 3 — Scheduling */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <SectionHeader
                title="Scheduling Defaults"
                subtitle="How videos are distributed across time slots"
              />

              <div className="grid grid-cols-3 gap-4">
                <Field label="Timezone">
                  <select
                    value={form.timezone}
                    onChange={(e) => set("timezone", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
                    <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
                    <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
                    <option value="Asia/Kuala_Lumpur">MYT (Kuala Lumpur)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </Field>
                <Field label="Videos Per Day" error={showError("videosPerDay")}>
                  <input
                    type="number"
                    min={1}
                    value={form.videosPerDay}
                    onChange={(e) => set("videosPerDay", Number(e.target.value))}
                    onBlur={() => markTouched("videosPerDay")}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle(showError("videosPerDay"))}
                  />
                </Field>
                <Field
                  label="Max Uploads / Day"
                  hint="Hard guardrail"
                  error={showError("maxUploadsPerDay")}
                >
                  <input
                    type="number"
                    min={1}
                    value={form.maxUploadsPerDay}
                    onChange={(e) => set("maxUploadsPerDay", Number(e.target.value))}
                    onBlur={() => markTouched("maxUploadsPerDay")}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle(showError("maxUploadsPerDay"))}
                  />
                </Field>
              </div>

              {/*
                Jendela + interval DIGANTI jam dasar + pergeseran harian.
                Menampilkan kontrol yang tidak lagi menggerakkan penjadwalan
                akan mengulang persis kesalahan chip "Zernio · Connected".
              */}
              <BaseTimesField
                baseTimes={form.baseTimes}
                drift={form.driftMinutesPerDay}
                timezone={form.timezone}
                onBaseTimes={(v) => set("baseTimes", v)}
                onDrift={(v) => set("driftMinutesPerDay", v)}
              />

              <Field label="Active Days" error={showError("activeDays")}>
                <div className="flex gap-1.5 mt-1">
                  {DAYS.map((day) => (
                    <button
                      key={day}
                      onClick={() => toggleDay(day)}
                      aria-pressed={form.activeDays.includes(day)}
                      className={`px-2.5 py-1 rounded text-xs font-mono border transition-fast ${
                        form.activeDays.includes(day)
                          ? "bg-accent/12 border-accent text-accent"
                          : "bg-surface-2 border-border text-text-muted"
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </Field>

              {/*
                Chip ini dulu selalu berbunyi "Connected" untuk ketiganya,
                tanpa memeriksa apa pun. Sekarang ia membaca keadaan
                sebenarnya: Zernio terhubung hanya bila kunci DAN channel
                sudah dipilih di langkah Credentials.
              */}
              <div>
                <div className="label-caps mb-3">Connected Services</div>
                <div className="flex gap-2 flex-wrap">
                  <ConnectedChip
                    label={
                      form.zernioAccountId
                        ? "Zernio · Channel terpilih"
                        : "Zernio · Belum dikonfigurasi"
                    }
                    connected={Boolean(form.zernioAccountId)}
                  />
                  <ConnectedChip label="Storage (R2) · Terhubung" connected />
                </div>
              </div>
            </div>
          )}

          {/* Step 4 — YouTube Defaults */}
          {currentStep === 4 && (
            <div className="space-y-5">
              <SectionHeader
                title="YouTube Defaults"
                subtitle="Applied to all uploads unless overridden per video"
              />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Default Visibility">
                  <select
                    value={form.visibility}
                    onChange={(e) => set("visibility", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    <option value="public">Public</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="private">Private</option>
                  </select>
                </Field>
                <Field label="Category">
                  <select
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    {["Science & Technology", "Education", "People & Blogs", "Howto & Style", "Entertainment", "Film & Animation"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      )
                    )}
                  </select>
                </Field>
              </div>
              <Field
                label="Baseline Tags"
                hint="Comma-separated — applied to all videos on this channel"
              >
                <input
                  value={form.baselineTags}
                  onChange={(e) => set("baselineTags", e.target.value)}
                  placeholder="tech, indonesia, tutorial, developer"
                  className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                  style={inputStyle()}
                />
              </Field>
              <Field label="Default Playlist ID (optional)">
                <input
                  value={form.playlistId}
                  onChange={(e) => set("playlistId", e.target.value)}
                  placeholder="PLxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 rounded-md border text-sm outline-none font-mono"
                  style={inputStyle()}
                />
              </Field>
              <Field label="Made for Kids (COPPA)">
                <Toggle
                  on={form.madeForKids}
                  onChange={(v) => set("madeForKids", v)}
                  label="Made for kids"
                  onText="Yes — content aimed at children"
                  offText="No — not made for children"
                />
              </Field>
            </div>
          )}

          {/* Step 5 — AI Settings */}
          {currentStep === 5 && (
            <div className="space-y-5">
              <SectionHeader
                title="AI Settings"
                subtitle="Overrides the global defaults from Settings for this channel"
              />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Output Language">
                  <select
                    value={form.aiLang}
                    onChange={(e) => set("aiLang", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    {["Bahasa Indonesia", "Bahasa Malaysia", "English", "Mixed (ID/EN)"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Tone">
                  <select
                    value={form.aiTone}
                    onChange={(e) => set("aiTone", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                    style={inputStyle()}
                  >
                    {["Conversational & Friendly", "Professional & Authoritative", "Casual & Relatable", "Educational & Clear"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      )
                    )}
                  </select>
                </Field>
              </div>
              <Field
                label="Few-shot Example Titles"
                hint="2–3 example titles from this channel that represent the style you want"
              >
                <textarea
                  value={form.fewShot}
                  onChange={(e) => set("fewShot", e.target.value)}
                  rows={4}
                  placeholder={
                    "5 Framework AI Terbaik untuk Developer Indonesia 2024\nTutorial Next.js 15 App Router — Dari Nol Sampai Deploy\nBelajar TypeScript dalam 2 Jam — Complete Crash Course"
                  }
                  className="w-full px-3 py-2 rounded-md border text-sm outline-none resize-none"
                  style={inputStyle()}
                />
              </Field>
              <Field label="CTA / Link Template" hint="Appended at the end of every description">
                <textarea
                  value={form.ctaTemplate}
                  onChange={(e) => set("ctaTemplate", e.target.value)}
                  rows={2}
                  placeholder={"Subscribe untuk konten tech terbaru.\nLink resource: [LINK]"}
                  className="w-full px-3 py-2 rounded-md border text-sm outline-none resize-none"
                  style={inputStyle()}
                />
              </Field>
            </div>
          )}

          {/* Step 6 — Warm-up */}
          {currentStep === 6 && (
            <div className="space-y-5">
              <SectionHeader
                title="Warm-up (optional)"
                subtitle="Ramp a new channel gradually instead of publishing at full rate on day one"
              />
              <Field label="Warm-up Mode">
                <Toggle
                  on={form.warmupEnabled}
                  onChange={(v) => set("warmupEnabled", v)}
                  label="Warm-up mode"
                  onText="Enabled — ramp up gradually"
                  offText="Disabled — publish at full rate immediately"
                />
              </Field>

              {form.warmupEnabled && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Ramp Duration (days)">
                    <input
                      type="number"
                      min={1}
                      value={form.warmupDays}
                      onChange={(e) => set("warmupDays", Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                      style={inputStyle()}
                    />
                  </Field>
                  <Field
                    label="Starting Videos / Day"
                    hint={`Ramps to ${form.videosPerDay}/day over the window`}
                    error={showError("warmupStartPerDay")}
                  >
                    <input
                      type="number"
                      min={1}
                      value={form.warmupStartPerDay}
                      onChange={(e) => set("warmupStartPerDay", Number(e.target.value))}
                      onBlur={() => markTouched("warmupStartPerDay")}
                      className="w-full px-3 py-2 rounded-md border text-sm outline-none"
                      style={inputStyle(showError("warmupStartPerDay"))}
                    />
                  </Field>
                </div>
              )}

              <div className="p-3 rounded-md border border-border bg-surface-2 text-xs text-text-muted">
                Warm-up reduces the risk of a new channel tripping YouTube's spam heuristics, which
                would take every upload on the channel down with it (PRD §12).
              </div>
            </div>
          )}
        </div>

        {/* Nav buttons */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => (currentStep > 0 ? setCurrentStep(currentStep - 1) : onCancel())}
            className="px-4 py-2 text-sm rounded-md border border-border text-text-secondary transition-fast hover:bg-overlay"
          >
            {currentStep === 0 ? "Cancel" : "← Back"}
          </button>

          <div className="flex items-center gap-3">
            {!formValid && currentStep === STEPS.length - 1 && (
              <span className="text-xs text-danger-text">
                {Object.keys(errors).length} field
                {Object.keys(errors).length > 1 ? "s" : ""} need attention
              </span>
            )}
            {currentStep === STEPS.length - 1 ? (
              <button
                onClick={handleSave}
                disabled={!formValid}
                className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-bg-0"
              >
                {editing ? "Save Changes →" : "Save Channel →"}
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={!stepValid && (STEP_FIELDS[currentStep] ?? []).every((f) => touched[f])}
                className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-bg-0"
              >
                Continue →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
