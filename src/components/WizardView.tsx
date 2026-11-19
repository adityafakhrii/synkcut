import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Film,
  Loader2,
  Lock,
  Mic,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import {
  CONTENT_FORMAT_LABELS,
  type ByokStatus,
  type CaptionPreset,
  type ContentFormat,
  type MotionPreset,
  type SynkcutProject,
  type TransitionPreset,
} from "../types/scene";
import {
  aiAssembleProject,
  aiGenerateScript,
  extractThumbnails,
  generateTtsAudio,
  isTauriRuntime,
  pickLocalAudio,
  pickLocalVideos,
  probeMedia,
  processUserAudio,
  toAssetUrl,
  type FootageInputItem,
  type HookOption,
  type ProcessedAudioResult,
} from "../lib/tauriBridge";

interface WizardViewProps {
  initialFormat?: ContentFormat;
  byokStatus: ByokStatus;
  onCancel: () => void;
  onOpenSettings: () => void;
  onSkipToBlank: (format: ContentFormat) => void;
  onProjectCreated: (project: SynkcutProject) => void;
}

const FORMAT_LIST: ContentFormat[] = ["ad_promo", "education", "storytelling", "review"];
const TONE_LIST = [
  { id: "santai", label: "Santai (Lo–Gue)" },
  { id: "persuasif", label: "Persuasif (Jualan)" },
  { id: "profesional", label: "Profesional" },
  { id: "lucu", label: "Lucu / Menghibur" },
];
const DURATION_LIST = [15, 30, 60];

const GEMINI_VOICES = [
  { id: "Kore", label: "Kore (Tegas & Jernih)" },
  { id: "Puck", label: "Puck (Energik & Santai)" },
  { id: "Aoede", label: "Aoede (Hangat & Natural)" },
  { id: "Charon", label: "Charon (Berat & Berwibawa)" },
  { id: "Fenrir", label: "Fenrir (Cepat & Dinamis)" },
];

const OPENAI_VOICES = [
  { id: "nova", label: "Nova (Cerah & Modern)" },
  { id: "alloy", label: "Alloy (Seimbang)" },
  { id: "onyx", label: "Onyx (Berat & Tegas)" },
  { id: "shimmer", label: "Shimmer (Ramah)" },
];

const CAPTION_PRESETS: Array<{ id: CaptionPreset; label: string; desc: string }> = [
  { id: "bold_pop", label: "Bold Pop", desc: "Kata aktif membesar + outline tebal" },
  { id: "clean_minimal", label: "Clean Minimal", desc: "Pill bersih untuk edukasi & brand" },
  { id: "kinetic_punch", label: "Kinetic Punch", desc: "2 kata besar per hentakan" },
  { id: "luxury_editorial", label: "Luxury Editorial", desc: "Serif halus bergaya editorial" },
  { id: "neon_tech", label: "Neon Tech", desc: "Sorotan modern untuk tech & gadget" },
];

const MOTION_PRESETS: Array<{ id: MotionPreset; label: string }> = [
  { id: "zoom_punch", label: "Zoom Punch" },
  { id: "smooth_ken_burns", label: "Smooth Ken Burns" },
  { id: "shake_impact", label: "Shake Impact" },
  { id: "slide_reveal", label: "Slide Reveal" },
  { id: "static_clean", label: "Static Clean" },
];

const TRANSITION_PRESETS: Array<{ id: TransitionPreset; label: string }> = [
  { id: "hard_cut", label: "Hard Cut" },
  { id: "whip_pan", label: "Whip Pan" },
  { id: "pop_zoom", label: "Pop Zoom" },
  { id: "glitch_flash", label: "Glitch Flash" },
  { id: "smooth_crossfade", label: "Smooth Crossfade" },
];

const BGM_PRESETS = [
  { id: "upbeat_promo", label: "Upbeat Promo" },
  { id: "lofi_education", label: "Lo-Fi Edukasi" },
  { id: "cinematic_story", label: "Cinematic Story" },
  { id: "tech_modern", label: "Tech Modern" },
  { id: "trendy_funk", label: "Trendy Funk" },
  { id: "chill_aesthetic", label: "Chill Aesthetic" },
];

const ACCENT_SWATCHES = ["#38E59D", "#F59E0B", "#38BDF8", "#F43F5E", "#FFFFFF"];

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)} dtk`;
}

export default function WizardView({
  initialFormat = "ad_promo",
  byokStatus,
  onCancel,
  onOpenSettings,
  onSkipToBlank,
  onProjectCreated,
}: WizardViewProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Brief & Script
  const [format, setFormat] = useState<ContentFormat>(initialFormat);
  const [tone, setTone] = useState("santai");
  const [targetDuration, setTargetDuration] = useState(30);
  const [topic, setTopic] = useState("");
  const [projectTitle, setProjectTitle] = useState("Konten Baru");
  const [hooks, setHooks] = useState<HookOption[]>([
    {
      id: "h1",
      angle: "Pain Point",
      text: "Capek bikin konten lama tapi views masih segitu-gitu aja?",
    },
    {
      id: "h2",
      angle: "Curiosity",
      text: "Ternyata satu perubahan di tiga detik pertama ini bisa langsung naikkan retensi!",
    },
    {
      id: "h3",
      angle: "Bold Claim",
      text: "Cukup dua menit, footage mentah langsung jadi konten siap tayang.",
    },
  ]);
  const [selectedHookId, setSelectedHookId] = useState("h1");
  const [bodySegments, setBodySegments] = useState<string[]>([
    "Tunjukkan masalah utama dan demo produk lo secara langsung dengan visual yang dekat.",
    "Berikan satu bukti nyata atau keunggulan yang membedakan produk lo dari yang lain.",
  ]);
  const [ctaText, setCtaText] = useState("Cek link sekarang sebelum promo minggu ini selesai!");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptProviderUsed, setScriptProviderUsed] = useState<string | null>(null);

  // Step 2: Footage & Audio Auto-Sync
  const [footageClips, setFootageClips] = useState<FootageInputItem[]>([]);
  const [isLoadingFootage, setIsLoadingFootage] = useState(false);
  const [audioTab, setAudioTab] = useState<"tts" | "recorded">("tts");
  const [ttsEngine, setTtsEngine] = useState<"gemini" | "openai" | "windows_offline">(
    byokStatus.providers.gemini?.configured
      ? "gemini"
      : byokStatus.providers.openai?.configured
        ? "openai"
        : "windows_offline"
  );
  const [ttsVoice, setTtsVoice] = useState(
    byokStatus.providers.openai?.configured && !byokStatus.providers.gemini?.configured
      ? "nova"
      : "Kore"
  );
  const [trimSilence, setTrimSilence] = useState(true);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioResult, setAudioResult] = useState<ProcessedAudioResult | null>(null);

  // Mic Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // Step 3: Click-to-Style Presets & Assemble
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>("bold_pop");
  const [accentColor, setAccentColor] = useState("#38E59D");
  const [motionPreset, setMotionPreset] = useState<MotionPreset>("zoom_punch");
  const [transitionPreset, setTransitionPreset] = useState<TransitionPreset>("whip_pan");
  const [overlayMode, setOverlayMode] = useState<
    | "auto"
    | "hook_headline"
    | "notification_banner"
    | "promo_badge"
    | "doodle_highlight"
    | "split_screen"
    | "none"
  >("auto");
  const [bgmPreset, setBgmPreset] = useState("upbeat_promo");
  const [autoDucking, setAutoDucking] = useState(true);
  const [autoSfx, setAutoSfx] = useState(true);
  const [isAssembling, setIsAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  const selectedHookText =
    hooks.find((h) => h.id === selectedHookId)?.text || hooks[0]?.text || "";

  const fullScriptText = [selectedHookText, ...bodySegments.filter((s) => s.trim()), ctaText]
    .filter((s) => s.trim())
    .join(" ");

  const hasAnyByok = Object.values(byokStatus.providers).some((p) => p.configured);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  async function handleGenerateScript() {
    setScriptError(null);
    if (!topic.trim()) {
      setScriptError("Tulis dulu topik, produk, atau pesan utama konten lo.");
      return;
    }

    setIsGeneratingScript(true);
    try {
      const res = await aiGenerateScript({
        topic: topic.trim(),
        format,
        tone,
        targetDurationSec: targetDuration,
      });
      setProjectTitle(res.projectTitle);
      setHooks(res.hooks);
      setSelectedHookId(res.hooks[0]?.id || "h1");
      setBodySegments(res.bodySegments);
      setCtaText(res.cta);
      setScriptProviderUsed(res.providerUsed);
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingScript(false);
    }
  }

  async function handleAddFootage() {
    if (!isTauriRuntime()) return;
    const paths = await pickLocalVideos();
    if (paths.length === 0) return;

    setIsLoadingFootage(true);
    try {
      const added: FootageInputItem[] = [];
      for (const path of paths) {
        if (footageClips.some((c) => c.path === path)) continue;
        const info = await probeMedia(path);
        const thumbnails = await extractThumbnails(path, 2);
        const fileName = path.split(/[\\/]/).pop() || "footage.mp4";
        added.push({
          path,
          fileName,
          durationMs: info.durationMs,
          thumbnails,
        });
      }
      setFootageClips((prev) => [...prev, ...added]);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingFootage(false);
    }
  }

  async function handleGenerateTts() {
    setAudioError(null);
    if (!fullScriptText.trim()) {
      setAudioError("Script kosong. Lengkapi Hook, Body, dan CTA di Langkah 1.");
      return;
    }
    setIsProcessingAudio(true);
    try {
      const res = await generateTtsAudio({
        text: fullScriptText,
        voiceName: ttsVoice,
        tone,
        engine: ttsEngine,
      });
      setAudioResult(res);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessingAudio(false);
    }
  }

  async function handleUploadUserAudio() {
    setAudioError(null);
    const picked = await pickLocalAudio();
    if (!picked) return;
    setIsProcessingAudio(true);
    try {
      const res = await processUserAudio({
        inputPath: picked,
        trimSilence,
        knownScript: fullScriptText,
      });
      setAudioResult(res);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessingAudio(false);
    }
  }

  async function handleToggleRecording() {
    setAudioError(null);
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);

        setIsProcessingAudio(true);
        try {
          const res = await processUserAudio({
            recordedBytes: bytes,
            recordedExt: "webm",
            trimSilence,
            knownScript: fullScriptText,
          });
          setAudioResult(res);
        } catch (err) {
          setAudioError(err instanceof Error ? err.message : String(err));
        } finally {
          setIsProcessingAudio(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordSeconds(0);
      setIsRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setAudioError("Akses mikrofon ditolak atau tidak tersedia. Pastikan izin mic Windows aktif.");
    }
  }

  async function handleAssembleProject() {
    setAssembleError(null);
    setIsAssembling(true);
    try {
      const project = await aiAssembleProject({
        projectTitle: projectTitle.trim() || topic.trim().slice(0, 32) || "Konten Baru",
        format,
        hookText: selectedHookText,
        bodySegments: bodySegments.filter((s) => s.trim().length > 0),
        ctaText,
        audioPath: audioResult?.audioPath ?? null,
        audioSource: audioResult ? (audioTab === "tts" ? "tts" : "recorded") : "demo",
        trimSilence,
        durationMs: audioResult?.durationMs ?? 0,
        words: audioResult?.words ?? [],
        footage: footageClips,
        captionPreset,
        accentColor,
        motionPreset,
        transitionPreset,
        overlayMode,
        bgmPreset,
        autoDucking,
        autoSfx,
      });
      onProjectCreated(project);
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAssembling(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top Wizard Header + 3-Step Indicator */}
      <header
        className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Batal
          </button>
          <h1 className="text-base font-bold tracking-tight">Wizard Racik Konten</h1>
        </div>

        {/* Clean 3-Step Progress */}
        <div className="hidden items-center gap-2 md:flex">
          {[
            { num: 1 as const, label: "Ide & Script" },
            { num: 2 as const, label: "Footage & Suara" },
            { num: 3 as const, label: "Gaya & Racik" },
          ].map((s, idx) => {
            const active = step === s.num;
            const done = step > s.num;
            return (
              <div key={s.num} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(s.num)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-elevated)" : "transparent",
                    color: active
                      ? "var(--text-primary)"
                      : done
                        ? "var(--text-secondary)"
                        : "var(--text-muted)",
                    border: active ? "1px solid var(--border-strong)" : "1px solid transparent",
                  }}
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full font-mono-num text-[11px] font-bold"
                    style={{
                      backgroundColor: done
                        ? "var(--accent)"
                        : active
                          ? "var(--cta-bg)"
                          : "var(--bg-elevated)",
                      color: done ? "#ffffff" : active ? "var(--cta-fg)" : "var(--text-muted)",
                    }}
                  >
                    {done ? <Check className="h-2.5 w-2.5" /> : s.num}
                  </span>
                  {s.label}
                </button>
                {idx < 2 && (
                  <span className="h-[1px] w-5" style={{ backgroundColor: "var(--border-subtle)" }} />
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onSkipToBlank(format)}
          className="text-xs font-medium hover:underline cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
        >
          Lewati ke Studio
        </button>
      </header>

      {/* Main Wizard Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-5xl">
          {/* BYOK Hint Banner if not configured */}
          {!hasAnyByok && (
            <div
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-xs"
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-strong)",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>
                API Key BYOK belum diatur. Kamu tetap bisa edit manual, atau hubungkan Gemini Key
                gratis untuk mengaktifkan AI Script, TTS, dan Multimodal Director.
              </span>
              <button
                type="button"
                onClick={onOpenSettings}
                className="ui-btn-secondary shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer"
              >
                Atur BYOK Sekarang
              </button>
            </div>
          )}

          {/* ==================== STEP 1: IDE & SCRIPT ==================== */}
          {step === 1 && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left: Brief Input */}
              <div className="ui-panel rounded-xl p-5 lg:col-span-5 space-y-4">
                <div>
                  <h2 className="text-sm font-bold">Brief Konten</h2>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Ceritakan produk atau topik yang mau dibahas, lalu biarkan AI meracik 3 opsi Hook.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Format Konten</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FORMAT_LIST.map((f) => {
                      const active = format === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFormat(f)}
                          className="ui-row rounded-md px-3 py-2 text-left text-xs font-medium cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--border-strong)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          {CONTENT_FORMAT_LABELS[f].label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Gaya Bahasa</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                    >
                      {TONE_LIST.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Target Durasi</label>
                    <div className="grid grid-cols-3 gap-1">
                      {DURATION_LIST.map((d) => {
                        const active = targetDuration === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setTargetDuration(d)}
                            className="rounded-md py-2 font-mono-num text-xs font-semibold cursor-pointer"
                            style={{
                              backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                              border: active
                                ? "1px solid var(--border-strong)"
                                : "1px solid var(--border-subtle)",
                            }}
                          >
                            {d}s
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="wizard-topic" className="mb-1.5 block text-xs font-semibold">
                    Topik / Produk / Promo
                  </label>
                  <textarea
                    id="wizard-topic"
                    rows={4}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Contoh: Kopi susu gula aren botolan 1 liter Rp45.000, tahan 5 hari di kulkas, cocok buat pekerja WFH biar hemat ngopi..."
                    className="ui-input w-full resize-none rounded-md p-3 text-xs leading-relaxed"
                  />
                </div>

                {scriptError && (
                  <div
                    className="rounded-md p-3 text-xs"
                    style={{
                      backgroundColor: "var(--danger-soft)",
                      border: "1px solid var(--danger)",
                      color: "var(--danger)",
                    }}
                  >
                    {scriptError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isGeneratingScript}
                  onClick={handleGenerateScript}
                  className="ui-btn-primary flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isGeneratingScript ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Meracik 3 Opsi Hook & Script...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate 3 Opsi Hook & Script
                    </>
                  )}
                </button>
              </div>

              {/* Right: Hook Picker + Inline Editable Body & CTA */}
              <div className="ui-panel rounded-xl p-5 lg:col-span-7 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Judul Proyek
                    </label>
                    <input
                      type="text"
                      value={projectTitle}
                      onChange={(e) => setProjectTitle(e.target.value)}
                      className="ui-input h-8 w-full rounded-md px-2.5 text-sm font-semibold"
                    />
                  </div>
                  {scriptProviderUsed && (
                    <span
                      className="mt-4 shrink-0 rounded px-2 py-1 font-mono-num text-[11px]"
                      style={{
                        backgroundColor: "var(--success-soft)",
                        color: "var(--success)",
                      }}
                    >
                      AI: {scriptProviderUsed}
                    </span>
                  )}
                </div>

                {/* 3 Hook Options */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: "var(--role-hook)" }}
                      />
                      Pilih 1 dari 3 Opsi Hook (0–3 detik)
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Klik untuk pilih · bisa langsung edit
                    </span>
                  </div>

                  <div className="space-y-2">
                    {hooks.map((h) => {
                      const active = selectedHookId === h.id;
                      return (
                        <div
                          key={h.id}
                          onClick={() => setSelectedHookId(h.id)}
                          className="rounded-lg p-3 transition-colors cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--border-strong)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          <div className="mb-1.5 flex items-center justify-between">
                            <span
                              className="text-[11px] font-semibold"
                              style={{
                                color: active ? "var(--accent)" : "var(--text-secondary)",
                              }}
                            >
                              {h.angle}
                            </span>
                            {active && (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-semibold"
                                style={{ color: "var(--accent)" }}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Dipilih
                              </span>
                            )}
                          </div>
                          <textarea
                            rows={2}
                            value={h.text}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              setSelectedHookId(h.id);
                              setHooks((prev) =>
                                prev.map((item) =>
                                  item.id === h.id ? { ...item, text: e.target.value } : item
                                )
                              );
                            }}
                            className="ui-input w-full resize-none rounded p-2 text-xs leading-relaxed"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Body Segments */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: "var(--role-body)" }}
                      />
                      Body ({bodySegments.length} segmen)
                    </span>
                    <button
                      type="button"
                      onClick={() => setBodySegments((prev) => [...prev, ""])}
                      className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Segmen
                    </button>
                  </div>

                  <div className="space-y-2">
                    {bodySegments.map((seg, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <textarea
                          rows={2}
                          value={seg}
                          onChange={(e) =>
                            setBodySegments((prev) =>
                              prev.map((item, i) => (i === idx ? e.target.value : item))
                            )
                          }
                          placeholder={`Segmen body ${idx + 1}...`}
                          className="ui-input flex-1 resize-none rounded-md p-2.5 text-xs leading-relaxed"
                        />
                        {bodySegments.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setBodySegments((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="ui-btn-secondary flex h-8 w-8 shrink-0 items-center justify-center rounded-md cursor-pointer"
                            style={{ color: "var(--danger)" }}
                            aria-label="Hapus segmen"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "var(--role-cta)" }}
                    />
                    CTA / Penutup
                  </label>
                  <textarea
                    rows={2}
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    className="ui-input w-full resize-none rounded-md p-2.5 text-xs leading-relaxed"
                  />
                </div>

                <div
                  className="flex items-center justify-end border-t pt-4"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold cursor-pointer"
                  >
                    Lanjut: Footage & Suara
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================== STEP 2: FOOTAGE & SUARA AUTO-SYNC ==================== */}
          {step === 2 && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left: Local Footage (Multi-Clip + Extracted Thumbnails) */}
              <div className="ui-panel rounded-xl p-5 lg:col-span-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold">Footage Lokal (Multi-Klip)</h2>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                      AI Multimodal akan melihat thumbnail klip untuk memasangkannya ke scene paling pas.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isLoadingFootage || !isTauriRuntime()}
                    onClick={handleAddFootage}
                    className="ui-btn-primary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {isLoadingFootage ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Tambah Video
                  </button>
                </div>

                {footageClips.length === 0 ? (
                  <div
                    className="rounded-lg p-6 text-center text-xs"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px dashed var(--border-strong)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Film className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} />
                    Belum ada footage lokal ditambahkan. Kamu bisa tambah 1–5 klip MP4/MOV sekarang,
                    atau langsung lanjut memakai backdrop studio dulu.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {footageClips.map((clip) => (
                      <div
                        key={clip.path}
                        className="rounded-lg p-3"
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold">{clip.fileName}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className="font-mono-num text-[11px]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {formatSec(clip.durationMs)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setFootageClips((prev) => prev.filter((c) => c.path !== clip.path))
                              }
                              className="p-1 cursor-pointer"
                              style={{ color: "var(--danger)" }}
                              aria-label="Hapus klip"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {clip.thumbnails.length > 0 && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {clip.thumbnails.map((src, i) => (
                              <img
                                key={i}
                                src={src}
                                alt={`Thumbnail ${i + 1}`}
                                className="h-16 w-full rounded object-cover"
                                style={{ border: "1px solid var(--border-subtle)" }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Coming Soon Slot: Google Flow / Seedance */}
                <div
                  className="flex items-center justify-between rounded-lg px-3.5 py-2.5 text-xs opacity-65"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px dashed var(--border-strong)",
                  }}
                >
                  <span className="inline-flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <Lock className="h-3.5 w-3.5" />
                    Generate AI Footage (Google Flow / Seedance)
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: "var(--bg-panel)", color: "var(--text-muted)" }}
                  >
                    Coming Soon
                  </span>
                </div>
              </div>

              {/* Right: Voiceover (TTS vs Suara Sendiri Auto-Sync) */}
              <div className="ui-panel rounded-xl p-5 lg:col-span-6 space-y-4">
                <div>
                  <h2 className="text-sm font-bold">Voiceover & Auto-Sync</h2>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Audio diproses dulu agar durasi scene & subtitle kinetik terkunci 100% akurat ke suara.
                  </p>
                </div>

                {/* Tab Switch */}
                <div
                  className="grid grid-cols-2 rounded-lg p-1"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setAudioTab("tts")}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor: audioTab === "tts" ? "var(--bg-panel)" : "transparent",
                      color: audioTab === "tts" ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    TTS AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudioTab("recorded")}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor: audioTab === "recorded" ? "var(--bg-panel)" : "transparent",
                      color: audioTab === "recorded" ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Suara Sendiri
                  </button>
                </div>

                {audioTab === "tts" ? (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold">Mesin TTS</label>
                      <select
                        value={ttsEngine}
                        onChange={(e) => {
                          const next = e.target.value as "gemini" | "openai" | "windows_offline";
                          setTtsEngine(next);
                          if (next === "gemini") setTtsVoice("Kore");
                          if (next === "openai") setTtsVoice("nova");
                        }}
                        className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                      >
                        <option value="gemini">Gemini Native TTS (BYOK · Disarankan)</option>
                        <option value="openai">OpenAI TTS (BYOK)</option>
                        <option value="windows_offline">Windows Offline TTS (Gratis Tanpa Key)</option>
                      </select>
                    </div>

                    {ttsEngine !== "windows_offline" && (
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold">Karakter Suara</label>
                        <select
                          value={ttsVoice}
                          onChange={(e) => setTtsVoice(e.target.value)}
                          className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                        >
                          {(ttsEngine === "gemini" ? GEMINI_VOICES : OPENAI_VOICES).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={isProcessingAudio || !isTauriRuntime()}
                      onClick={handleGenerateTts}
                      className="ui-btn-primary flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {isProcessingAudio ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Membuat Suara & Sinkronisasi Kata...
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5" />
                          Generate Suara TTS & Auto-Sync
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 text-xs cursor-pointer"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <span>Potong Jeda Kosong Otomatis (&gt;0,4 dtk)</span>
                      <input
                        type="checkbox"
                        checked={trimSilence}
                        onChange={(e) => setTrimSilence(e.target.checked)}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={isProcessingAudio || !isTauriRuntime()}
                        onClick={handleToggleRecording}
                        className="flex h-10 items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                        style={{
                          backgroundColor: isRecording ? "var(--danger)" : "var(--cta-bg)",
                          color: isRecording ? "#ffffff" : "var(--cta-fg)",
                        }}
                      >
                        {isRecording ? (
                          <>
                            <Square className="h-3.5 w-3.5 fill-current" />
                            Stop ({recordSeconds}s)
                          </>
                        ) : (
                          <>
                            <Mic className="h-3.5 w-3.5" />
                            Rekam Mic
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isProcessingAudio || isRecording || !isTauriRuntime()}
                        onClick={handleUploadUserAudio}
                        className="ui-btn-secondary flex h-10 items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload MP3/WAV
                      </button>
                    </div>

                    {isProcessingAudio && (
                      <div
                        className="flex items-center gap-2 rounded-md p-3 text-xs"
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Memotong jeda & mengambil timestamp kata otomatis...
                      </div>
                    )}
                  </div>
                )}

                {audioError && (
                  <div
                    className="rounded-md p-3 text-xs"
                    style={{
                      backgroundColor: "var(--danger-soft)",
                      border: "1px solid var(--danger)",
                      color: "var(--danger)",
                    }}
                  >
                    {audioError}
                  </div>
                )}

                {audioResult && (
                  <div
                    className="rounded-lg p-3.5 space-y-2.5"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--accent)",
                    }}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className="inline-flex items-center gap-1.5 font-semibold"
                        style={{ color: "var(--success)" }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Suara Siap · {audioResult.providerUsed}
                      </span>
                      <span className="font-mono-num text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {formatSec(audioResult.durationMs)} · {audioResult.words.length} kata
                      </span>
                    </div>
                    <audio
                      controls
                      src={toAssetUrl(audioResult.audioPath)}
                      className="h-8 w-full"
                    />
                  </div>
                )}

                <div
                  className="flex items-center justify-between border-t pt-4"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="ui-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-medium cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Kembali
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold cursor-pointer"
                  >
                    {audioResult ? "Lanjut: Pilih Gaya" : "Lanjut (Audio Demo Dulu)"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================== STEP 3: KLIK-KLIK PRESET & RACIK ==================== */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* Left: Caption Style & Accent */}
                <div className="ui-panel rounded-xl p-5 lg:col-span-6 space-y-4">
                  <h2 className="text-sm font-bold">Style Kinetic Caption & Warna</h2>
                  <div className="space-y-1.5">
                    {CAPTION_PRESETS.map((p) => {
                      const active = captionPreset === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setCaptionPreset(p.id)}
                          className="ui-row flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-left cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--border-strong)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          <div>
                            <div className="text-xs font-semibold">{p.label}</div>
                            <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                              {p.desc}
                            </div>
                          </div>
                          {active && (
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: "var(--accent)" }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold">Warna Sorotan Kata</div>
                    <div className="flex items-center gap-2.5">
                      {ACCENT_SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setAccentColor(hex)}
                          className="h-7 w-7 rounded-full cursor-pointer"
                          style={{
                            backgroundColor: hex,
                            border:
                              accentColor === hex
                                ? "2px solid var(--text-primary)"
                                : "1px solid var(--border-strong)",
                          }}
                          aria-label={`Pilih warna ${hex}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: Motion, Transition, Overlay, Audio Pack */}
                <div className="ui-panel rounded-xl p-5 lg:col-span-6 space-y-4">
                  <h2 className="text-sm font-bold">Motion, Overlay & Audio Pack</h2>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold">Motion Utama</label>
                      <select
                        value={motionPreset}
                        onChange={(e) => setMotionPreset(e.target.value as MotionPreset)}
                        className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                      >
                        {MOTION_PRESETS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold">Transisi Antar Scene</label>
                      <select
                        value={transitionPreset}
                        onChange={(e) => setTransitionPreset(e.target.value as TransitionPreset)}
                        className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                      >
                        {TRANSITION_PRESETS.map((tr) => (
                          <option key={tr.id} value={tr.id}>
                            {tr.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Visual Overlay</label>
                    <select
                      value={overlayMode}
                      onChange={(e) =>
                        setOverlayMode(
                          e.target.value as
                            | "auto"
                            | "hook_headline"
                            | "notification_banner"
                            | "promo_badge"
                            | "doodle_highlight"
                            | "split_screen"
                            | "none"
                        )
                      }
                      className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                    >
                      <option value="auto">Otomatis Dipilihkan AI Director (Disarankan)</option>
                      <option value="hook_headline">Hook Headline Card (3 Detik Awal)</option>
                      <option value="notification_banner">Native Notification Banner</option>
                      <option value="promo_badge">Promo / Callout Badge</option>
                      <option value="doodle_highlight">Doodle Marker Highlight</option>
                      <option value="split_screen">Split-Screen / B-Roll Comparison</option>
                      <option value="none">Tanpa Overlay Tambahan</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Mood Backsound (BGM)</label>
                    <select
                      value={bgmPreset}
                      onChange={(e) => setBgmPreset(e.target.value)}
                      className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                    >
                      <option value="none">Tanpa BGM</option>
                      {BGM_PRESETS.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <label
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 text-xs cursor-pointer"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <span>Auto-Ducking BGM</span>
                      <input
                        type="checkbox"
                        checked={autoDucking}
                        onChange={(e) => setAutoDucking(e.target.checked)}
                      />
                    </label>
                    <label
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 text-xs cursor-pointer"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <span>Auto SFX Transisi</span>
                      <input
                        type="checkbox"
                        checked={autoSfx}
                        onChange={(e) => setAutoSfx(e.target.checked)}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {assembleError && (
                <div
                  className="rounded-lg p-3.5 text-xs"
                  style={{
                    backgroundColor: "var(--danger-soft)",
                    border: "1px solid var(--danger)",
                    color: "var(--danger)",
                  }}
                >
                  {assembleError}
                </div>
              )}

              {/* Final Assemble Action Strip */}
              <div className="ui-panel flex flex-wrap items-center justify-between gap-4 rounded-xl px-5 py-4">
                <div className="space-y-0.5 text-xs">
                  <div className="font-bold">{projectTitle || "Konten Baru"}</div>
                  <div className="font-mono-num text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {1 + bodySegments.filter((s) => s.trim()).length + 1} scene · {footageClips.length}{" "}
                    footage lokal ·{" "}
                    {audioResult ? `suara tersinkron (${formatSec(audioResult.durationMs)})` : "audio demo"}
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isAssembling}
                    onClick={() => setStep(2)}
                    className="ui-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-medium cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Kembali
                  </button>
                  <button
                    type="button"
                    disabled={isAssembling}
                    onClick={handleAssembleProject}
                    className="ui-btn-primary inline-flex h-9 items-center gap-2 rounded-md px-5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {isAssembling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        AI Director Sedang Meracik Video...
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" />
                        Racik Video dengan AI Director
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
