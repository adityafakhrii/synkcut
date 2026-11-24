import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  Film,
  FolderOpen,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  Palette,
  Pencil,
  Play,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  CONTENT_FORMAT_LABELS,
  type ByokStatus,
  type ContentFormat,
  type ProjectStyleReference,
  type ProjectSummary,
  type StoryboardBeat,
  type SynkcutProject,
} from "../types/scene";
import { BUILTIN_SAMPLES, type SampleTemplate } from "../engine/sampleTemplates";
import {
  aiGenerateScript,
  aiPlanStoryboard,
  extractFootageFrames,
  generateTtsAudio,
  isTauriRuntime,
  pickLocalVideos,
  probeMedia,
  type FootageInputItem,
  type HookOption,
  type ProcessedAudioResult,
  type StyleReferenceResult,
} from "../lib/tauriBridge";
import DesignReferencePanel from "./DesignReferencePanel";
import PreProductionReviewModal, { type PreProductionDraft } from "./PreProductionReviewModal";
import ProjectPosterCanvas from "./ProjectPosterCanvas";

interface ProjectsHomeViewProps {
  section: "projects" | "samples";
  projects: ProjectSummary[];
  byokStatus: ByokStatus;
  isLoading: boolean;
  onNavigateSamples: () => void;
  onOpenNewModal: () => void;
  onInstantProjectCreated: (project: SynkcutProject) => Promise<void>;
  onUseSample: (sample: SampleTemplate) => void;
  onOpenProject: (projectId: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

const FORMAT_FILTERS: Array<{ id: "all" | ContentFormat; label: string }> = [
  { id: "all", label: "Semua" },
  { id: "ad_promo", label: "Iklan" },
  { id: "education", label: "Edukasi" },
  { id: "storytelling", label: "Storytelling" },
  { id: "review", label: "Review" },
];

function formatDuration(ms: number): string {
  const sec = Math.max(0, ms / 1000);
  const mins = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function formatUpdatedAt(iso: string): string {
  try {
    const dt = new Date(iso);
    return dt.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Baru saja";
  }
}

function inferFormatFromPrompt(prompt: string): ContentFormat {
  const lower = prompt.toLowerCase();
  if (
    lower.includes("promo") ||
    lower.includes("diskon") ||
    lower.includes("jual") ||
    lower.includes("iklan") ||
    lower.includes("rp")
  ) {
    return "ad_promo";
  }
  if (
    lower.includes("review") ||
    lower.includes("unboxing") ||
    lower.includes("bedah") ||
    lower.includes("3d") ||
    lower.includes("smartphone") ||
    lower.includes("laptop")
  ) {
    return "review";
  }
  if (lower.includes("cerita") || lower.includes("kisah") || lower.includes("opini")) {
    return "storytelling";
  }
  return "education";
}

const QUICK_PROMPT_IDEAS = [
  "Jelasin cara kerja Wi-Fi di rumah dalam 30 detik",
  "Bedah 3D lapisan komponen di dalam smartphone",
  "Iklan kopi susu gula aren botolan 1 liter Rp45rb",
];

export default function ProjectsHomeView({
  section,
  projects,
  byokStatus,
  isLoading,
  onNavigateSamples,
  onOpenNewModal,
  onInstantProjectCreated,
  onUseSample,
  onOpenProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
}: ProjectsHomeViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<"all" | ContentFormat>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Lovable-style 1-Prompt / Footage Auto-Cut Home Composer
  const [heroPrompt, setHeroPrompt] = useState("");
  const [heroVisualMode, setHeroVisualMode] = useState<"motion" | "footage" | "hybrid">("motion");
  const [showDesignPanel, setShowDesignPanel] = useState(false);
  const [styleRef, setStyleRef] = useState<StyleReferenceResult | null>(null);
  const [attachedClips, setAttachedClips] = useState<FootageInputItem[]>([]);
  const [heroTtsEngine, setHeroTtsEngine] = useState<"auto" | "gemini" | "openai" | "windows_offline">(
    byokStatus.providers.gemini?.configured
      ? "gemini"
      : byokStatus.providers.openai?.configured
        ? "openai"
        : "windows_offline"
  );
  const [isLoadingClips, setIsLoadingClips] = useState(false);
  const [isHelpingScript, setIsHelpingScript] = useState(false);
  const [isCreatingVideo, setIsCreatingVideo] = useState(false);
  const [createStatusText, setCreateStatusText] = useState("");
  const [heroError, setHeroError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<PreProductionDraft | null>(null);

  const hasAnyByok = Object.values(byokStatus.providers).some((p) => p.configured);
  const isFootageMode = heroVisualMode === "footage";
  const totalAttachedDurationMs = attachedClips.reduce((acc, c) => acc + (c.durationMs || 0), 0);
  const canSubmitHero =
    heroPrompt.trim().length > 0 &&
    !isCreatingVideo &&
    (!isFootageMode || attachedClips.length > 0);

  async function handleAttachClips() {
    if (!isTauriRuntime()) {
      setHeroError("Pemilihan footage lokal hanya tersedia di aplikasi desktop Synkcut.");
      return;
    }
    const paths = await pickLocalVideos();
    if (paths.length === 0) return;
    setHeroError(null);
    setIsLoadingClips(true);
    try {
      const next: FootageInputItem[] = [];
      for (const path of paths) {
        if (attachedClips.some((c) => c.path === path)) continue;
        const info = await probeMedia(path);
        const frames = await extractFootageFrames(path, 4);
        next.push({
          path,
          fileName: path.split(/[\\/]/).pop() || "clip.mp4",
          durationMs: info.durationMs,
          thumbnails: frames.map((f) => f.dataUrl),
          frameTimestampsMs: frames.map((f) => f.timestampMs),
        });
      }
      setAttachedClips((prev) => [...prev, ...next]);
      if (heroVisualMode === "motion") setHeroVisualMode("footage");
    } catch (err) {
      setHeroError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingClips(false);
    }
  }

  async function handleHelpWriteFootageScript() {
    const seed = heroPrompt.trim();
    if (!seed || isHelpingScript) return;
    setHeroError(null);
    setIsHelpingScript(true);
    try {
      const inferredFormat = inferFormatFromPrompt(seed);
      const generated = await aiGenerateScript({
        topic: seed,
        format: inferredFormat,
        tone: "santai",
        targetDurationSec: 30,
        visualMode: "footage",
        styleReferenceSummary: styleRef?.customDesign?.artDirectionNotes ?? styleRef?.styleDnaSummary ?? null,
      });
      const full = [
        generated.hooks[0]?.text || "",
        ...generated.bodySegments,
        generated.cta,
      ]
        .filter((s) => s.trim())
        .join("\n");
      setHeroPrompt(full);
    } catch (err) {
      setHeroError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsHelpingScript(false);
    }
  }

  async function handleInstantCreate(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = heroPrompt.trim();
    if (!trimmed || isCreatingVideo) return;

    if (isFootageMode && attachedClips.length === 0) {
      setHeroError("Mode Footage wajib melampirkan minimal 1 video footage lokal (bisa lebih dari 1).");
      return;
    }

    setHeroError(null);
    setIsCreatingVideo(true);
    setCreateStatusText("1/3 Menyusun script & 3 opsi hook...");
    try {
      const inferredFormat = inferFormatFromPrompt(trimmed);
      let projectTitle = trimmed.split(/\s+/).slice(0, 5).join(" ");
      let hooks: HookOption[] = [
        {
          id: "h1",
          angle: "Utama",
          text: trimmed.length <= 72 ? trimmed : `${trimmed.slice(0, 68)}...`,
        },
      ];
      let bodySegments = [
        `Tunjukkan langsung keunggulan nyata dari ${projectTitle.toLowerCase()} secara jelas dan spesifik.`,
        "Berikan alasan kuat kenapa penonton perlu mencobanya sekarang juga.",
      ];
      let ctaText = "Cek sekarang juga sebelum kehabisan!";
      let fullScript = trimmed;

      if (isFootageMode) {
        projectTitle =
          trimmed
            .split(/[.!?\n]/)[0]
            ?.trim()
            .split(/\s+/)
            .slice(0, 5)
            .join(" ") || "Video Footage Auto-Cut";
        fullScript = trimmed;
      } else if (isTauriRuntime() && hasAnyByok) {
        const generated = await aiGenerateScript({
          topic: trimmed,
          format: inferredFormat,
          tone: "santai",
          targetDurationSec: 30,
          visualMode: heroVisualMode,
          styleReferenceSummary:
            styleRef?.customDesign?.artDirectionNotes ?? styleRef?.styleDnaSummary ?? null,
        });
        projectTitle = generated.projectTitle || projectTitle;
        if (generated.hooks.length > 0) hooks = generated.hooks;
        if (generated.bodySegments.length > 0) bodySegments = generated.bodySegments;
        ctaText = generated.cta || ctaText;
        fullScript = [hooks[0]?.text || "", ...bodySegments, ctaText]
          .filter((s) => s.trim())
          .join(" ");
      } else {
        fullScript = [hooks[0]?.text || "", ...bodySegments, ctaText]
          .filter((s) => s.trim())
          .join(" ");
      }

      // 2/3 Auto-generate dubbing voiceover sample so user can HEAR & review it BEFORE generating video!
      setCreateStatusText("2/3 Membuat sampel suara dubbing (voiceover)...");
      let audioRes: ProcessedAudioResult | null = null;
      try {
        audioRes = await generateTtsAudio({
          text: fullScript,
          voiceName: heroTtsEngine === "openai" ? "nova" : "Kore",
          tone: inferredFormat === "ad_promo" ? "persuasif" : "santai",
          engine: heroTtsEngine === "windows_offline" ? "windows_offline" : "auto",
        });
      } catch {
        audioRes = null;
      }

      // 3/3 Plan micro-beat storyboard (2.5-4.5s/beat, 100% custom visual concepts — ZERO sample assets!)
      let beats: StoryboardBeat[] = [];
      if (!isFootageMode) {
        setCreateStatusText("3/3 Merancang storyboard micro-beat tanpa template...");
        const styleReference: ProjectStyleReference | null = styleRef
          ? {
              sourceType: styleRef.sourceType,
              url: styleRef.url ?? undefined,
              title: styleRef.title,
              thumbnails: styleRef.thumbnails,
              styleDnaSummary: styleRef.styleDnaSummary,
              logoDataUrl: styleRef.logoDataUrl ?? null,
              brandHeadings: styleRef.brandHeadings,
              brandColors: styleRef.brandColors,
              customDesign: styleRef.customDesign,
            }
          : null;
        try {
          const planned = await aiPlanStoryboard({
            projectTitle,
            format: inferredFormat,
            fullScript,
            durationMs: audioRes?.durationMs ?? 24000,
            words: audioRes?.words ?? [],
            customDesign: styleRef?.customDesign ?? null,
            styleReference,
          });
          beats = planned.beats;
        } catch {
          beats = [];
        }
      }

      // Open Pre-Production Review Panel instead of jumping straight to video!
      setReviewDraft({
        projectTitle,
        format: inferredFormat,
        visualMode: heroVisualMode,
        hooks,
        selectedHookId: hooks[0]?.id || "h1",
        bodySegments,
        cta: ctaText,
        fullScript,
        audio: audioRes,
        beats,
        styleRef,
        attachedClips,
        ttsEngine: heroTtsEngine,
      });
    } catch (err) {
      setHeroError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingVideo(false);
      setCreateStatusText("");
    }
  }

  const samplePreviewProjects = useMemo(
    () =>
      Object.fromEntries(
        BUILTIN_SAMPLES.map((sample) => [sample.id, sample.buildProject(sample.title)])
      ),
    []
  );

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((p) => {
      if (formatFilter !== "all" && p.format !== formatFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.hookText.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [projects, searchQuery, formatFilter]);

  const filteredSamples = useMemo(() => {
    if (formatFilter === "all") return BUILTIN_SAMPLES;
    return BUILTIN_SAMPLES.filter((s) => s.format === formatFilter);
  }, [formatFilter]);

  function startRename(item: ProjectSummary) {
    setConfirmDeleteId(null);
    setRenamingId(item.id);
    setRenameValue(item.name);
  }

  async function commitRename(projectId: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      await onRenameProject(projectId, trimmed);
    }
    setRenamingId(null);
  }

  /* ---------------- DEDICATED SAMPLE GALLERY VIEW ---------------- */
  if (section === "samples") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6"
          style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold tracking-tight">Sample Bawaan</h1>
            <span className="font-mono-num text-xs" style={{ color: "var(--text-muted)" }}>
              {filteredSamples.length} template
            </span>
          </div>

          <div className="flex items-center gap-1 rounded-md p-0.5" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
            {FORMAT_FILTERS.map((f) => {
              const active = formatFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormatFilter(f.id)}
                  className="rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-panel)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <p className="mb-5 text-xs" style={{ color: "var(--text-secondary)" }}>
            Pilih sample untuk langsung membuat proyek baru lengkap dengan struktur Hook–Body–CTA, gaya caption, dan motion—tinggal ganti footage lokal & teksnya.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredSamples.map((sample) => {
              const fmtInfo = CONTENT_FORMAT_LABELS[sample.format];
              const previewProj = samplePreviewProjects[sample.id];
              return (
                <div
                  key={sample.id}
                  className="group flex flex-col overflow-hidden rounded-lg transition-colors"
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onUseSample(sample)}
                    className="relative aspect-[9/16] w-full overflow-hidden bg-black text-left cursor-pointer"
                  >
                    <ProjectPosterCanvas
                      project={previewProj}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                      <span
                        className="rounded px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: "rgba(13, 15, 18, 0.82)",
                          color: "#f1f3f7",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        {fmtInfo.label}
                      </span>
                      {sample.isAiMotion && (
                        <span
                          className="rounded px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "rgba(9, 121, 84, 0.92)",
                            color: "#ffffff",
                          }}
                        >
                          AI Motion
                        </span>
                      )}
                    </div>
                    <span
                      className="font-mono-num absolute right-2.5 bottom-2.5 rounded px-1.5 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: "rgba(13, 15, 18, 0.82)",
                        color: "#f1f3f7",
                      }}
                    >
                      {sample.durationLabel.slice(0, 5)}
                    </span>
                  </button>

                  <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
                    <div>
                      <h2 className="text-sm font-bold">{sample.title}</h2>
                      <p
                        className="mt-1 line-clamp-2 text-xs leading-relaxed"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {sample.summary}
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        <span>{sample.captionLabel}</span>
                        <span>·</span>
                        <span>{sample.motionLabel}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUseSample(sample)}
                        className="ui-btn-secondary w-full rounded-md py-2 text-xs font-semibold cursor-pointer"
                      >
                        Pakai Sample Ini
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- MY PROJECTS WORKSPACE ---------------- */
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sticky Contextual Desktop Toolbar */}
      <div
        className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2.5 shrink-0">
          <h1 className="text-base font-bold tracking-tight">My Projects</h1>
          <span className="font-mono-num text-xs" style={{ color: "var(--text-muted)" }}>
            {projects.length}
          </span>
        </div>

        {/* Center/Right Controls: Search + Format Filter + Grid/List */}
        <div className="flex items-center gap-2.5">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-2.5 h-3.5 w-3.5"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari proyek..."
              className="ui-input h-8 w-44 rounded-md pr-7 pl-8 text-xs lg:w-56"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 cursor-pointer"
                style={{ color: "var(--text-muted)" }}
                aria-label="Hapus pencarian"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Format Filter Pills */}
          <div
            className="hidden items-center gap-0.5 rounded-md p-0.5 xl:flex"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {FORMAT_FILTERS.map((f) => {
              const active = formatFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormatFilter(f.id)}
                  className="rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-panel)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Grid / List Toggle */}
          <div
            className="flex items-center rounded-md p-0.5"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className="flex h-7 w-7 items-center justify-center rounded cursor-pointer"
              style={{
                backgroundColor: viewMode === "grid" ? "var(--bg-panel)" : "transparent",
                color: viewMode === "grid" ? "var(--text-primary)" : "var(--text-muted)",
              }}
              title="Tampilan Grid Poster"
              aria-label="Tampilan Grid Poster"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className="flex h-7 w-7 items-center justify-center rounded cursor-pointer"
              style={{
                backgroundColor: viewMode === "list" ? "var(--bg-panel)" : "transparent",
                color: viewMode === "list" ? "var(--text-primary)" : "var(--text-muted)",
              }}
              title="Tampilan List"
              aria-label="Tampilan List"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Main Workspace */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-8">
        {/* LOVABLE-STYLE 1-PROMPT TO VIDEO HERO COMPOSER */}
        <section className="mx-auto w-full max-w-3xl pt-2">
          <div className="mb-4 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Mau bikin video apa hari ini?</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Tulis 1 ide — review dulu script, sampel suara dubbing, &amp; konsep tiap beat, lalu AI menulis kode motion kustom tanpa template.
            </p>
          </div>

          <form
            onSubmit={handleInstantCreate}
            className="rounded-2xl p-3.5 shadow-sm space-y-3"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-strong)",
            }}
          >
            {/* Mode-Specific Prompt / Mandatory Footage Script Box */}
            <div className="space-y-2">
              {isFootageMode && (
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-xs font-bold">
                    1. Script Video <span style={{ color: "var(--danger)" }}>*Wajib</span>
                  </span>
                  <button
                    type="button"
                    disabled={!heroPrompt.trim() || isHelpingScript || !hasAnyByok}
                    onClick={handleHelpWriteFootageScript}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline disabled:opacity-45 cursor-pointer"
                    style={{ color: "var(--accent)" }}
                    title="Tulis topik singkat lalu klik ini agar AI kembangkan jadi script utuh"
                  >
                    {isHelpingScript ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {isHelpingScript ? "Menyusun script..." : "Kembangkan ide jadi script AI"}
                  </button>
                </div>
              )}

              <textarea
                rows={isFootageMode ? 4 : 2}
                value={heroPrompt}
                onChange={(e) => setHeroPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (!isFootageMode && e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleInstantCreate();
                  }
                }}
                placeholder={
                  isFootageMode
                    ? "Tempel atau tulis script lengkap video lo di sini (mis. 3–8 kalimat). AI akan men-generate suara voiceover & memotong otomatis semua footage menjadi 1 video utuh sesuai durasi script..."
                    : "Contoh: Jelasin cara kerja internet dalam 30 detik pakai animasi diagram & grafik..."
                }
                className="w-full resize-none bg-transparent px-1 text-sm leading-relaxed outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>

            {/* MANDATORY MULTI-FOOTAGE & AUTO-VOICEOVER STRIP (Always Visible in Footage Mode, Optional in Hybrid) */}
            {(isFootageMode || heroVisualMode === "hybrid" || attachedClips.length > 0) && (
              <div
                className="space-y-2.5 border-t pt-3"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">
                      {isFootageMode ? "2. Footage Video (Multi-Klip)" : "Klip Footage Lokal"}
                      {isFootageMode && (
                        <span className="ml-1" style={{ color: "var(--danger)" }}>
                          *Wajib
                        </span>
                      )}
                    </span>
                    {attachedClips.length > 0 && (
                      <span
                        className="font-mono-num text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {attachedClips.length} klip · total {formatDuration(totalAttachedDurationMs)}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isFootageMode && (
                      <div className="flex items-center gap-1.5">
                        <Volume2 className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                        <select
                          value={heroTtsEngine}
                          onChange={(e) =>
                            setHeroTtsEngine(
                              e.target.value as "auto" | "gemini" | "openai" | "windows_offline"
                            )
                          }
                          aria-label="Mesin Suara Voiceover Otomatis"
                          className="ui-input h-8 rounded-md px-2 text-xs font-medium"
                        >
                          <option value="gemini">Suara: Gemini TTS (Auto-Fallback)</option>
                          <option value="openai">Suara: OpenAI TTS (Auto-Fallback)</option>
                          <option value="windows_offline">Suara: Windows Offline TTS</option>
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={isLoadingClips || !isTauriRuntime()}
                      onClick={handleAttachClips}
                      className="ui-btn-secondary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold disabled:opacity-45 cursor-pointer"
                    >
                      {isLoadingClips ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {attachedClips.length > 0 ? "+ Tambah Klip Lagi" : "Pilih Footage (Bisa >1)"}
                    </button>
                  </div>
                </div>

                {attachedClips.length === 0 && isFootageMode ? (
                  <div
                    className="rounded-lg px-3 py-2.5 text-xs"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px dashed var(--border-strong)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Pilih 1 atau beberapa klip video (MP4/MOV/MKV). AI akan melihat isi frame
                    setiap klip lalu memotong & menggabungkannya otomatis mengikuti timing suara
                    script lo.
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {attachedClips.map((c, idx) => (
                      <span
                        key={c.path}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium"
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <Film className="h-3 w-3 shrink-0" style={{ color: "var(--accent)" }} />
                        <span className="max-w-[160px] truncate">
                          #{idx + 1} {c.fileName}
                        </span>
                        <span className="font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {(c.durationMs / 1000).toFixed(1)}s
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedClips((prev) => prev.filter((x) => x.path !== c.path))
                          }
                          className="cursor-pointer"
                          style={{ color: "var(--text-muted)" }}
                          aria-label="Hapus klip"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* CUSTOM DESIGN REFERENCE DRAWER (4 Modes: Image/Ctrl+V, Link, Clip, Text Prompt) */}
            {showDesignPanel && (
              <div
                className="space-y-2 border-t pt-3"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">
                    Referensi & Arahan Desain Custom (Bukan Template)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDesignPanel(false)}
                    className="text-xs hover:underline cursor-pointer"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Tutup
                  </button>
                </div>
                <DesignReferencePanel value={styleRef} onChange={setStyleRef} compact />
              </div>
            )}

            {/* Compact active Custom Design pill when panel is collapsed */}
            {!showDesignPanel && styleRef && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: styleRef.customDesign.palette.accentPrimary }}
                  />
                  Desain Custom: {styleRef.customDesign.name}
                  <button
                    type="button"
                    onClick={() => setShowDesignPanel(true)}
                    className="underline ml-1 cursor-pointer"
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    onClick={() => setStyleRef(null)}
                    className="cursor-pointer"
                    aria-label="Hapus referensi desain"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </div>
            )}

            {heroError && (
              <div
                className="rounded-md px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--danger-soft)",
                  color: "var(--danger)",
                }}
              >
                {heroError}
              </div>
            )}

            {/* Composer Bottom Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: "motion" as const, label: "AI Motion", icon: Shapes },
                  { id: "footage" as const, label: "Footage", icon: Film },
                  { id: "hybrid" as const, label: "Campur", icon: Layers },
                ].map((m) => {
                  const Icon = m.icon;
                  const active = heroVisualMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setHeroVisualMode(m.id);
                        setHeroError(null);
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                        color: active ? "var(--accent)" : "var(--text-secondary)",
                        border: active
                          ? "1px solid var(--accent)"
                          : "1px solid var(--border-subtle)",
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {m.label}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setShowDesignPanel((v) => !v)}
                  className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium cursor-pointer"
                  style={
                    styleRef
                      ? { borderColor: "var(--accent)", color: "var(--accent)" }
                      : undefined
                  }
                >
                  <Palette className="h-3.5 w-3.5" />
                  Ref Desain Custom
                  {styleRef && <CheckCircle2 className="h-3 w-3" />}
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onOpenNewModal}
                  className="text-xs font-medium hover:underline cursor-pointer"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Mode Terpandu
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitHero}
                  className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {isCreatingVideo ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {createStatusText ? "Meracik..." : "Meracik..."}
                    </>
                  ) : (
                    <>
                      {isFootageMode ? "Review Script & Suara" : "Siapkan Script & Suara"}
                      <ArrowUp className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {isCreatingVideo && createStatusText && (
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                }}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--accent)" }} />
                {createStatusText}
              </div>
            )}
          </form>

          {/* 1-Click Example Idea Pills */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {QUICK_PROMPT_IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setHeroPrompt(idea)}
                className="ui-btn-secondary rounded-full px-3 py-1 text-xs font-medium cursor-pointer"
              >
                {idea}
              </button>
            ))}
          </div>
        </section>

        {/* Saved Projects Area */}
        <section>
          {projects.length > 0 && (
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">Proyek Tersimpan ({filteredProjects.length})</h3>
            </div>
          )}
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="overflow-hidden rounded-lg"
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div
                    className="aspect-[9/16] w-full animate-pulse"
                    style={{ backgroundColor: "var(--bg-elevated)" }}
                  />
                  <div className="p-3 space-y-2">
                    <div
                      className="h-3.5 w-3/4 animate-pulse rounded"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    />
                    <div
                      className="h-3 w-1/2 animate-pulse rounded"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            projects.length === 0 ? null : (
              <div
                className="flex flex-col items-center justify-center rounded-lg px-6 py-10 text-center"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  border: "1px dashed var(--border-strong)",
                }}
              >
                <FolderOpen className="h-5 w-5" style={{ color: "var(--text-muted)" }} />
                <h3 className="mt-3 text-sm font-bold">Tidak ada proyek yang cocok</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Coba ubah kata kunci pencarian atau reset filter format di toolbar atas.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setFormatFilter("all");
                  }}
                  className="ui-btn-secondary mt-4 h-8 rounded-md px-3.5 text-xs font-semibold cursor-pointer"
                >
                  Reset Filter
                </button>
              </div>
            )
          ) : viewMode === "grid" ? (
            /* VISUAL 9:16 POSTER GRID (DEFAULT) */
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredProjects.map((item) => {
                const isRenaming = renamingId === item.id;
                const isConfirmingDelete = confirmDeleteId === item.id;
                const fmtLabel = CONTENT_FORMAT_LABELS[item.format]?.label || item.format;

                return (
                  <div
                    key={item.id}
                    className="group flex flex-col overflow-hidden rounded-lg transition-colors"
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {/* Live 9:16 Poster Preview */}
                    <button
                      type="button"
                      onClick={() => onOpenProject(item.id)}
                      className="relative aspect-[9/16] w-full overflow-hidden bg-black text-left cursor-pointer"
                    >
                      <ProjectPosterCanvas
                        summary={item}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />

                      {/* Hover Play Indicator */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-150 group-hover:bg-black/25">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                          style={{
                            backgroundColor: "var(--cta-bg)",
                            color: "var(--cta-fg)",
                          }}
                        >
                          <Play className="h-4 w-4 fill-current" />
                        </div>
                      </div>

                      {/* Top-Left Format Pill */}
                      <span
                        className="absolute top-2 left-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: "rgba(13, 15, 18, 0.78)",
                          color: "#f1f3f7",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        {fmtLabel}
                      </span>

                      {/* Bottom-Right Duration Pill */}
                      <span
                        className="font-mono-num absolute right-2 bottom-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: "rgba(13, 15, 18, 0.82)",
                          color: "#f1f3f7",
                        }}
                      >
                        {formatDuration(item.durationMs)}
                      </span>
                    </button>

                    {/* Clean Card Metadata Footer */}
                    <div className="flex flex-col gap-2 p-3">
                      {isRenaming ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(item.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="ui-input h-7 min-w-0 flex-1 rounded px-2 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => commitRename(item.id)}
                            className="ui-btn-primary flex h-7 w-7 shrink-0 items-center justify-center rounded cursor-pointer"
                            aria-label="Simpan nama baru"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="ui-btn-secondary flex h-7 w-7 shrink-0 items-center justify-center rounded cursor-pointer"
                            aria-label="Batal"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenProject(item.id)}
                          className="truncate text-left text-xs font-bold hover:underline cursor-pointer"
                          title={item.name}
                        >
                          {item.name}
                        </button>
                      )}

                      <div
                        className="flex items-center justify-between gap-2 text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <span className="truncate font-mono-num">
                          {item.sceneCount} scene · {formatUpdatedAt(item.updatedAt)}
                        </span>
                      </div>

                      {/* Subtle Action Row */}
                      {isConfirmingDelete ? (
                        <div className="flex items-center justify-between gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteProject(item.id);
                              setConfirmDeleteId(null);
                            }}
                            className="flex-1 rounded py-1 text-[11px] font-semibold cursor-pointer"
                            style={{ backgroundColor: "var(--danger)", color: "#ffffff" }}
                          >
                            Hapus permanen
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="ui-btn-secondary rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-between border-t pt-2"
                          style={{ borderColor: "var(--border-subtle)" }}
                        >
                          <button
                            type="button"
                            onClick={() => onOpenProject(item.id)}
                            className="text-[11px] font-semibold hover:underline cursor-pointer"
                            style={{ color: "var(--text-primary)" }}
                          >
                            Buka Studio
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onDuplicateProject(item.id)}
                              className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                              title="Duplikat proyek (A/B test Hook)"
                              aria-label="Duplikat proyek"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startRename(item)}
                              className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                              title="Ganti nama"
                              aria-label="Ganti nama"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                              title="Hapus proyek"
                              aria-label="Hapus proyek"
                              style={{ color: "var(--danger)" }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* PRECISION LIST VIEW (ZERO COLUMN COLLISION) */
            <div
              className="overflow-x-auto rounded-lg"
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div className="min-w-[760px]">
                {/* Header */}
                <div
                  className="grid items-center gap-4 border-b px-4 py-2.5 text-[11px] font-semibold"
                  style={{
                    gridTemplateColumns: "minmax(220px, 1fr) 136px 70px 84px 142px 156px",
                    borderColor: "var(--border-subtle)",
                    backgroundColor: "var(--bg-elevated)",
                    color: "var(--text-muted)",
                  }}
                >
                  <div>Nama Proyek</div>
                  <div>Format</div>
                  <div className="text-right">Scene</div>
                  <div className="text-right">Durasi</div>
                  <div className="text-right">Terakhir Diubah</div>
                  <div className="text-right">Aksi</div>
                </div>

                {/* Rows */}
                {filteredProjects.map((item, idx) => {
                  const isRenaming = renamingId === item.id;
                  const isConfirmingDelete = confirmDeleteId === item.id;
                  const fmtLabel = CONTENT_FORMAT_LABELS[item.format]?.label || item.format;

                  return (
                    <div
                      key={item.id}
                      className="ui-row grid items-center gap-4 px-4 py-2.5 text-xs"
                      style={{
                        gridTemplateColumns: "minmax(220px, 1fr) 136px 70px 84px 142px 156px",
                        borderBottom:
                          idx < filteredProjects.length - 1
                            ? "1px solid var(--border-subtle)"
                            : "none",
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="h-11 w-[25px] shrink-0 overflow-hidden rounded-sm bg-black"
                          style={{ border: "1px solid var(--border-subtle)" }}
                        >
                          <ProjectPosterCanvas summary={item} className="h-full w-full object-cover" />
                        </div>

                        {isRenaming ? (
                          <div className="flex flex-1 items-center gap-1.5">
                            <input
                              type="text"
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename(item.id);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              className="ui-input h-7 flex-1 rounded px-2 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => commitRename(item.id)}
                              className="ui-btn-primary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingId(null)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onOpenProject(item.id)}
                            className="truncate text-left font-semibold hover:underline cursor-pointer"
                          >
                            {item.name}
                          </button>
                        )}
                      </div>

                      <div className="truncate whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {fmtLabel}
                      </div>

                      <div className="text-right font-mono-num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {item.sceneCount}
                      </div>

                      <div className="text-right font-mono-num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {formatDuration(item.durationMs)}
                      </div>

                      <div
                        className="text-right font-mono-num text-[11px] whitespace-nowrap"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {formatUpdatedAt(item.updatedAt)}
                      </div>

                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {isConfirmingDelete ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteProject(item.id);
                                setConfirmDeleteId(null);
                              }}
                              className="rounded px-2 py-1 text-[11px] font-semibold cursor-pointer"
                              style={{ backgroundColor: "var(--danger)", color: "#ffffff" }}
                            >
                              Hapus
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="ui-btn-secondary rounded px-2 py-1 text-[11px] cursor-pointer"
                            >
                              Batal
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onOpenProject(item.id)}
                              className="ui-btn-secondary rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                            >
                              Buka
                            </button>
                            <button
                              type="button"
                              onClick={() => onDuplicateProject(item.id)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                              title="Duplikat"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startRename(item)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                              title="Ganti nama"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                              title="Hapus"
                              style={{ color: "var(--danger)" }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Compact Visual Sample Shelf (1 clean row linking to full Sample tab) */}
        <section className="border-t pt-6" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold">Mulai dari Sample Bawaan</h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                Klik salah satu poster untuk langsung remix dengan footage & skrip lo sendiri.
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateSamples}
              className="inline-flex items-center gap-1 text-xs font-semibold hover:underline cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              Semua Sample ({BUILTIN_SAMPLES.length})
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {BUILTIN_SAMPLES.slice(0, 4).map((sample) => {
              const previewProj = samplePreviewProjects[sample.id];
              return (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => onUseSample(sample)}
                  className="group ui-row flex items-center gap-3.5 rounded-lg p-2.5 text-left cursor-pointer"
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div
                    className="h-24 w-[54px] shrink-0 overflow-hidden rounded bg-black"
                    style={{ border: "1px solid var(--border-subtle)" }}
                  >
                    <ProjectPosterCanvas
                      project={previewProj}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold">{sample.title}</div>
                    <div
                      className="mt-1 text-[11px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {sample.captionLabel} · {sample.motionLabel}
                    </div>
                    <div
                      className="mt-2 font-mono-num text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {sample.durationLabel.slice(0, 5)} · 9:16
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {reviewDraft && (
        <PreProductionReviewModal
          draft={reviewDraft}
          byokStatus={byokStatus}
          onClose={() => setReviewDraft(null)}
          onProjectReady={async (project) => {
            setReviewDraft(null);
            setHeroPrompt("");
            setStyleRef(null);
            setAttachedClips([]);
            setShowDesignPanel(false);
            await onInstantProjectCreated(project);
          }}
        />
      )}
    </div>
  );
}
