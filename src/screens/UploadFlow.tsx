import { useMemo, useRef, useState } from "react";
import { videosApi } from "../lib/api";
import { readVideoDuration, uploadVideo } from "../lib/upload";
import { useApp, type NewVideoInput } from "../store/AppStore";

interface UploadFlowProps {
  onClose: () => void;
  onConfirm: (input: NewVideoInput) => void;
}

const STEPS = ["Upload", "Brief", "Metadata"];

const PLACEHOLDER_THUMB =
  "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=160&h=90&fit=crop&auto=format";

/** PRD F3 validation limits. */
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const TAGS_MAX = 500;
const RESTRICTED_TERMS = ["gratis 100%", "klik di sini sekarang", "dijamin viral", "subscribe wajib"];

interface Metadata {
  titles: string[];
  description: string;
  tags: string[];
  thumbnailText: string;
}

interface Check {
  key: string;
  pass: boolean;
  note: string;
}

function validate(title: string, description: string, tags: string[]): Check[] {
  const tagChars = tags.join(",").length;
  const haystack = `${title} ${description}`.toLowerCase();
  const hit = RESTRICTED_TERMS.find((t) => haystack.includes(t));
  return [
    {
      key: "title",
      pass: title.length <= TITLE_MAX,
      note: `${title.length} chars — limit ${TITLE_MAX}`,
    },
    {
      key: "description",
      pass: description.length <= DESCRIPTION_MAX,
      note: `${description.length} chars — limit ${DESCRIPTION_MAX}`,
    },
    {
      key: "tags",
      pass: tagChars <= TAGS_MAX,
      note: `${tagChars} chars total — limit ${TAGS_MAX}`,
    },
    {
      key: "keywords",
      pass: !hit,
      note: hit ? `Restricted term found: "${hit}"` : "No restricted terms detected",
    },
  ];
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-1 rounded-full overflow-hidden bg-surface-2">
      <div
        className="h-full rounded-full transition-all bg-accent"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

type GeneratingState = "idle" | "generating" | "done";

const fieldClass =
  "w-full px-3 py-2 rounded-md border border-border bg-surface-2 text-text-primary text-sm outline-none";

export default function UploadFlow({ onClose, onConfirm }: UploadFlowProps) {
  const { channels, dryRun } = useApp();
  const activeChannels = channels.filter((c) => c.status === "active");

  const [step, setStep] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Id video di server, terisi setelah byte-nya benar-benar sampai di R2. */
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [brief, setBrief] = useState("");
  const [channelId, setChannelId] = useState(activeChannels[0]?.id ?? "");
  const [contentType, setContentType] = useState("Tutorial");
  const [market, setMarket] = useState("Indonesia");

  const [generatingState, setGeneratingState] = useState<GeneratingState>("idle");
  const [attempt, setAttempt] = useState(0);
  const [metadata, setMetadata] = useState<Metadata>({ titles: [], description: "", tags: [], thumbnailText: "" });
  const [selectedTitle, setSelectedTitle] = useState(0);
  const [description, setDescription] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState(1);

  const title = metadata.titles[selectedTitle] ?? "";
  const checks = useMemo(
    () => validate(title, description, metadata.tags),
    [title, description, metadata.tags]
  );
  const valid = checks.every((c) => c.pass);
  const canRegenerate = attemptsLeft > 0;

  /**
   * Upload SUNGGUHAN ke R2, multipart, dengan progress per part.
   *
   * Video didaftarkan ke server hanya SETELAH seluruh byte sampai — jadi tidak
   * pernah ada baris di D1 yang menunjuk objek yang belum ada.
   */
  const startUpload = async (file: File) => {
    if (!channelId) {
      setError("Pilih channel dulu sebelum mengunggah.");
      return;
    }
    setError(null);
    setFileName(file.name);
    setUploadProgress(0);
    setUploadDone(false);

    try {
      const durationSec = await readVideoDuration(file);
      const result = await uploadVideo({
        file,
        channelId,
        brief,
        contentType,
        market,
        durationSec,
        onProgress: (f) => setUploadProgress(Math.round(f * 100)),
      });
      setVideoId(result.videoId);
      setUploadDone(true);
    } catch (err) {
      setUploadProgress(0);
      setFileName(null);
      setError(err instanceof Error ? err.message : "Upload gagal.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void startUpload(file);
  };

  /** Memanggil Gemini sungguhan lewat server; validasi F3 juga dijalankan server. */
  const runGenerate = async () => {
    if (!videoId) return;
    setGeneratingState("generating");
    setError(null);
    try {
      const res = await videosApi.generate(videoId);
      setMetadata({
        titles: res.metadata.titles,
        description: res.metadata.description,
        tags: res.metadata.tags,
        thumbnailText: "",
      });
      setDescription(res.metadata.description);
      setSelectedTitle(0);
      setAttempt((a) => a + 1);
      setAttemptsLeft(res.attemptsLeft);
      setGeneratingState("done");
      if (res.sentToReview) {
        setError("Validasi masih gagal setelah regenerate — video dikirim ke review queue.");
      }
    } catch (err) {
      setGeneratingState("idle");
      setError(err instanceof Error ? err.message : "Gagal generate metadata.");
    }
  };

  const submit = async (reviewQueue: boolean) => {
    if (!videoId) return;
    try {
      // Konfirmasi divalidasi ulang di server. Kalau ditolak, jangan tutup
      // dialog — operator perlu melihat kenapa.
      if (!reviewQueue) {
        await videosApi.confirm(videoId, {
          titleSelected: title,
          description,
          tags: metadata.tags,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konfirmasi ditolak server.");
      return;
    }

    onConfirm({
      channelId,
      title,
      titleVariants: metadata.titles,
      description,
      tags: metadata.tags,
      brief,
      type: contentType,
      market,
      thumbnail: PLACEHOLDER_THUMB,
      reviewQueue,
    });
  };

  const dropZoneBorder = isDragging
    ? "border-accent bg-accent/3"
    : uploadDone
      ? "border-success bg-surface-2"
      : "border-border bg-surface-2";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="w-[640px] rounded-xl border border-border bg-surface-1 flex flex-col overflow-hidden"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-text-primary">Upload Video</span>
            <div className="flex items-center gap-2">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  {i > 0 && <div className="w-4 h-px bg-border" />}
                  <div
                    className={`flex items-center gap-1 text-xs ${
                      i === step ? "text-accent" : i < step ? "text-success" : "text-text-muted"
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center font-mono text-xs border ${
                        i === step
                          ? "border-accent bg-accent/8"
                          : i < step
                            ? "border-success"
                            : "border-border"
                      }`}
                    >
                      {i < step ? "✓" : i + 1}
                    </span>
                    {s}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close upload"
            className="text-xs hover:opacity-60 text-text-muted"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Step 0 — Upload */}
          {step === 0 && (
            <div className="space-y-4">
              <div
                role="button"
                tabIndex={0}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-fast ${dropZoneBorder}`}
                style={{ height: "200px" }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void startUpload(f);
                  }}
                />
                {!fileName ? (
                  <>
                    <div className="text-3xl mb-3 text-border">↑</div>
                    <div className="text-sm font-medium text-text-secondary">
                      Drop video file here
                    </div>
                    <div className="text-xs mt-1 text-text-muted">
                      or click to select — MP4, MOV, MKV up to 128 GB
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium mb-2 text-text-primary">{fileName}</div>
                    {!uploadDone ? (
                      <div className="w-48 space-y-1">
                        <ProgressBar value={uploadProgress} />
                        <div className="flex justify-between">
                          <span className="font-mono text-xs text-text-muted">
                            Uploading to R2...
                          </span>
                          <span className="font-mono text-xs text-accent">
                            {Math.round(uploadProgress)}%
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="status-dot published" />
                        <span className="text-xs text-success">
                          Upload complete — stored in R2
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="p-3 rounded-md text-xs bg-surface-2 text-text-muted">
                Video uploads directly to Cloudflare R2. Files never pass through the application
                server.
              </div>
            </div>
          )}

          {/* Step 1 — Brief */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="label-caps block mb-1.5" htmlFor="brief">
                  Brief
                </label>
                <textarea
                  id="brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="Describe the video in 1–2 sentences. The AI will use this to generate title, description, and tags."
                  rows={4}
                  className={`${fieldClass} resize-none`}
                />
                <div className="text-xs mt-1 text-text-muted">
                  1–2 sentences. Be specific — the AI uses this as the only context.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-caps block mb-1.5" htmlFor="channel">
                    Channel
                  </label>
                  <select
                    id="channel"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className={fieldClass}
                  >
                    {activeChannels.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-caps block mb-1.5" htmlFor="type">
                    Content Type
                  </label>
                  <select
                    id="type"
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className={fieldClass}
                  >
                    {["Tutorial", "Explainer", "Vlog", "Recipe", "Review", "Education"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-caps block mb-1.5" htmlFor="market">
                    Target Market
                  </label>
                  <select
                    id="market"
                    value={market}
                    onChange={(e) => setMarket(e.target.value)}
                    className={fieldClass}
                  >
                    <option>Indonesia</option>
                    <option>Malaysia</option>
                    <option>International</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Metadata */}
          {step === 2 && (
            <div className="space-y-4">
              {generatingState === "idle" && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="text-sm text-text-secondary">Ready to generate AI metadata</div>
                  <div className="text-xs text-text-muted">
                    Uses your channel's tone, language, and few-shot examples
                  </div>
                  <button
                    onClick={() => void runGenerate()}
                    className="mt-2 px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 bg-accent text-bg-0"
                  >
                    Generate Metadata →
                  </button>
                </div>
              )}

              {generatingState === "generating" && (
                <div className="rounded-lg border border-border bg-surface-2 p-4 space-y-3">
                  <div className="label-caps text-accent">Generating...</div>
                  {["Title variants", "Description", "Tags", "Thumbnail text", "Validation"].map(
                    (item, i) => (
                      <div key={item} className="flex items-center gap-3">
                        <div className="skeleton h-2 w-2 rounded-full" />
                        <div
                          className="skeleton h-3 flex-1 rounded"
                          style={{ maxWidth: `${95 - i * 9}%` }}
                        />
                      </div>
                    )
                  )}
                </div>
              )}

              {generatingState === "done" && (
                <div className="space-y-4">
                  <div>
                    <div className="label-caps mb-2">Title Variants — select one</div>
                    <div className="space-y-1.5">
                      {metadata.titles.map((t, i) => {
                        const tooLong = t.length > TITLE_MAX;
                        const selected = selectedTitle === i;
                        return (
                          <div
                            key={i}
                            role="radio"
                            aria-checked={selected}
                            tabIndex={0}
                            onClick={() => setSelectedTitle(i)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedTitle(i);
                              }
                            }}
                            className={`flex items-start gap-3 px-3 py-2.5 rounded-md border cursor-pointer transition-fast ${
                              selected ? "border-accent bg-accent/6" : "border-border bg-surface-2"
                            }`}
                          >
                            <div
                              className={`w-3.5 h-3.5 rounded-full border mt-0.5 flex-shrink-0 flex items-center justify-center ${
                                selected ? "border-accent" : "border-border"
                              }`}
                            >
                              {selected && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                            </div>
                            <span className="text-xs flex-1 text-text-primary">{t}</span>
                            <span
                              className={`font-mono text-xs flex-shrink-0 ${
                                tooLong ? "text-danger-text" : "text-text-muted"
                              }`}
                            >
                              {t.length}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="label-caps mb-2">Description</div>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      className="w-full px-3 py-2 rounded-md border border-border bg-surface-2 text-text-secondary text-xs outline-none resize-none leading-relaxed"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="label-caps mb-2">Tags</div>
                      <div className="flex flex-wrap gap-1">
                        {metadata.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 rounded font-mono bg-surface-3 text-text-secondary"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="label-caps mb-2">Thumbnail Text</div>
                      <div className="px-3 py-2 rounded-md text-xs font-mono bg-surface-2 text-accent">
                        {metadata.thumbnailText}
                      </div>
                    </div>
                  </div>

                  {/* Validation — PRD F3 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="label-caps">Validation</div>
                      <div className="font-mono text-xs text-text-muted">attempt {attempt}/2</div>
                    </div>
                    <div className="space-y-1">
                      {checks.map((check) => (
                        <div key={check.key} className="flex items-center gap-2">
                          <span
                            className={`font-mono text-xs ${
                              check.pass ? "text-success" : "text-danger"
                            }`}
                          >
                            {check.pass ? "✓" : "✗"}
                          </span>
                          <span className="text-xs capitalize text-text-secondary">
                            {check.key}
                          </span>
                          <span
                            className={`text-xs ml-auto ${
                              check.pass ? "text-text-muted" : "text-danger-subtle"
                            }`}
                          >
                            {check.note}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {!valid && (
                    <div className="p-3 rounded-md border border-danger/20 bg-danger/8 text-xs text-danger-subtle">
                      {canRegenerate
                        ? "Validation failed. Regenerate once, or edit the fields above to bring them within limits."
                        : "Regenerate already used. This video can only be sent to the review queue until the metadata passes validation."}
                    </div>
                  )}

                  {valid && dryRun && (
                    <div className="p-3 rounded-md border border-accent/25 bg-accent/6 text-xs text-accent">
                      Dry-run is ON — the video enters the pool but nothing will be pushed to Zernio.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <button
            onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
            className="px-4 py-2 text-sm rounded-md border border-border text-text-secondary transition-fast hover:bg-overlay"
          >
            {step === 0 ? "Cancel" : "← Back"}
          </button>
          <div className="flex gap-2">
            {step === 0 && (
              <button
                onClick={() => setStep(1)}
                disabled={!uploadDone}
                className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-bg-0"
              >
                Continue →
              </button>
            )}
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={brief.trim().length < 10 || !channelId}
                className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-bg-0"
              >
                Continue →
              </button>
            )}
            {step === 2 && generatingState === "done" && (
              <>
                {!valid && canRegenerate && (
                  <button
                    onClick={() => void runGenerate()}
                    className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 bg-accent text-bg-0"
                  >
                    Regenerate
                  </button>
                )}
                {!valid && !canRegenerate && (
                  <button
                    onClick={() => void submit(true)}
                    className="px-5 py-2 text-sm font-medium rounded-md border border-warning/40 text-warning transition-fast hover:bg-overlay"
                  >
                    Send to Review Queue
                  </button>
                )}
                <button
                  onClick={() => void submit(false)}
                  disabled={!valid}
                  className="px-5 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed bg-accent text-bg-0"
                >
                  Confirm — Add to Library
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
