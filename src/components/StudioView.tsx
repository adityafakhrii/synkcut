import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Film,
  FolderOpen,
  Layers,
  Loader2,
  Minus,
  Moon,
  Music,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Shapes,
  Shield,
  SlidersHorizontal,
  Square,
  Sun,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import type {
  AiMotionEngine,
  AiMotionSpec,
  AiMotionTheme,
  ByokStatus,
  CaptionPreset,
  MotionPreset,
  SceneOverlay,
  SceneRole,
  SceneVisualSource,
  SynkcutProject,
  TransitionPreset,
} from "../types/scene";
import {
  AI_MOTION_ENGINES,
  createBreakdown3DPreset,
  createDefaultAiMotion,
} from "../engine/aiMotionPresets";
import { getProjectDurationMs, rebuildWordsFromScenes } from "../engine/sampleProject";
import {
  addSceneAfter,
  deleteScene,
  duplicateScene,
  reorderScenes,
  summarizeProjectDiff,
  updateSceneDuration,
  updateSceneRole,
} from "../engine/sceneOps";
import { renderProjectFrame } from "../engine/canvasRenderer";
import {
  ExportCancelledError,
  checkWebCodecsSupport,
  estimateExportSizeBytes,
  exportProjectToMp4,
} from "../engine/exportEngine";
import {
  aiCopilotPatch,
  checkSidecars,
  ensureAudioPackAsset,
  extractThumbnails,
  generateTtsAudio,
  getAudioPackCatalog,
  isTauriRuntime,
  listenExportProgress,
  pickExportSavePath,
  pickLocalAudio,
  pickLocalVideo,
  probeMedia,
  revealInExplorer,
  saveProject,
  toAssetUrl,
  type AudioPackCatalog,
  type ExportResult,
  type MediaProbeInfo,
  type SidecarStatus,
} from "../lib/tauriBridge";
import AiMotionEditor from "./AiMotionEditor";

export type ManualDrawerTab = "visual" | "style" | "audio";

interface StudioViewProps {
  initialProject: SynkcutProject;
  byokStatus: ByokStatus;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onBackHome: () => void;
  onProjectSaved: () => void;
  initialManualOpen?: boolean;
  initialManualTab?: ManualDrawerTab;
  initialTimeMs?: number;
}

interface DirectorLogItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  changes?: string[];
  snapshotBefore?: SynkcutProject;
  reverted?: boolean;
}

const CAPTION_PRESETS: Array<{ id: CaptionPreset; label: string; sample: string }> = [
  { id: "bold_pop", label: "Bold Pop", sample: "KATA AKTIF TEBAL" },
  { id: "clean_minimal", label: "Clean Minimal", sample: "Bersih & rapi" },
  { id: "kinetic_punch", label: "Kinetic Punch", sample: "2 KATA BESAR" },
  { id: "luxury_editorial", label: "Luxury Editorial", sample: "Serif elegan" },
  { id: "neon_tech", label: "Neon Tech", sample: "Modern glow tipis" },
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

const OVERLAY_PRESETS: Array<{ id: "none" | SceneOverlay["type"]; label: string }> = [
  { id: "none", label: "Tanpa Overlay" },
  { id: "hook_headline", label: "Hook Headline Card" },
  { id: "notification_banner", label: "Native Notification Banner" },
  { id: "promo_badge", label: "Promo / Callout Badge" },
  { id: "doodle_highlight", label: "Doodle Marker Highlight" },
  { id: "split_screen", label: "Split-Screen / B-Roll" },
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

function formatTimecode(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatEta(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "Menghitung...";
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec < 60) return `${totalSec} dtk`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}d`;
}

export default function StudioView({
  initialProject,
  byokStatus,
  theme,
  onToggleTheme,
  onBackHome,
  onProjectSaved,
  initialManualOpen = false,
  initialManualTab = "visual",
  initialTimeMs = 0,
}: StudioViewProps) {
  const [project, setProject] = useState<SynkcutProject>(initialProject);
  const [pastHistory, setPastHistory] = useState<SynkcutProject[]>([]);
  const [futureHistory, setFutureHistory] = useState<SynkcutProject[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");

  // Clean 2-Column Lovable Workspace State
  const [showManualDrawer, setShowManualDrawer] = useState(initialManualOpen);
  const [manualTab, setManualTab] = useState<ManualDrawerTab>(initialManualTab);
  const [selectedSceneId, setSelectedSceneId] = useState<string>(() => {
    const matched = initialProject.scenes.find(
      (s) => initialTimeMs >= s.startMs && initialTimeMs < s.endMs
    );
    return matched?.id || initialProject.scenes[0]?.id || "";
  });
  const [targetAllScenes, setTargetAllScenes] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(false); // OFF by default for clean canvas hero
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Playback state
  const [currentTimeMs, setCurrentTimeMs] = useState(initialTimeMs);
  const [isPlaying, setIsPlaying] = useState(false);

  // AI Director interactive feed (Hero Left Column)
  const [promptInput, setPromptInput] = useState("");
  const [isPatchingAi, setIsPatchingAi] = useState(false);
  const [directorLog, setDirectorLog] = useState<DirectorLogItem[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Diagnostics (surfaced quietly inside Export Modal)
  const [webCodecs, setWebCodecs] = useState({ supported: false, avcSupported: false });
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);

  // Local media state
  const [footagePath, setFootagePath] = useState<string | null>(
    initialProject.scenes.find((s) => s.media.path)?.media.path ?? null
  );
  const [footageProbe, setFootageProbe] = useState<MediaProbeInfo | null>(null);
  const [clipProbes, setClipProbes] = useState<Record<string, MediaProbeInfo>>({});
  const [footageThumbs, setFootageThumbs] = useState<string[]>([]);
  const [audioPath, setAudioPath] = useState<string | null>(initialProject.voiceover.audioPath);
  const [generateDemoAudio, setGenerateDemoAudio] = useState(!initialProject.voiceover.audioPath);
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);

  // Bottom Scene Strip drag-drop
  const [draggedSceneIdx, setDraggedSceneIdx] = useState<number | null>(null);
  const [dragOverSceneIdx, setDragOverSceneIdx] = useState<number | null>(null);

  // Audio Pack (12 SFX & 6 BGM)
  const [audioCatalog, setAudioCatalog] = useState<AudioPackCatalog>({ sfx: [], bgm: [] });
  const [bgmAssetUrl, setBgmAssetUrl] = useState<string | null>(null);
  const [isAuditioningBgm, setIsAuditioningBgm] = useState(false);
  const [auditioningSfxId, setAuditioningSfxId] = useState<string | null>(null);

  // Export state
  const [resolution, setResolution] = useState<"1080p" | "720p">("1080p");
  const [exportFps, setExportFps] = useState<30 | 60>(30);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStage, setExportStage] = useState<"idle" | "init" | "encoding" | "muxing" | "done">(
    "idle"
  );
  const [exportPct, setExportPct] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [exportElapsedMs, setExportElapsedMs] = useState(0);
  const [exportEtaMs, setExportEtaMs] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);
  const sfxCacheRef = useRef<Record<string, string>>({});
  const lastTriggeredSceneIdRef = useRef<string | null>(null);
  const scrubBarRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTsRef = useRef<number>(0);
  const isFirstRenderRef = useRef(true);
  const isScrubbingRef = useRef(false);

  const totalDurationMs = useMemo(() => Math.max(1000, getProjectDurationMs(project)), [project]);

  const activeScene = useMemo(() => {
    const byId = project.scenes.find((s) => s.id === selectedSceneId);
    return byId ?? project.scenes[0] ?? null;
  }, [project.scenes, selectedSceneId]);

  const activeSceneIndex = useMemo(() => {
    if (!activeScene) return 0;
    const idx = project.scenes.findIndex((s) => s.id === activeScene.id);
    return idx >= 0 ? idx : 0;
  }, [project.scenes, activeScene]);

  const projectClipPaths = useMemo(() => {
    const set = new Set<string>();
    for (const s of project.scenes) {
      if (s.media.path) set.add(s.media.path);
      if (s.media.secondaryPath) set.add(s.media.secondaryPath);
    }
    if (footagePath) set.add(footagePath);
    return Array.from(set);
  }, [project.scenes, footagePath]);

  const hasAnyFootage = projectClipPaths.length > 0;
  const hasAnyMotion = project.scenes.some((s) => s.visualSource === "motion");

  const activeProviderInfo = byokStatus.providers[byokStatus.activeProvider];
  const activeByokOk = activeProviderInfo?.configured;
  const providerName =
    byokStatus.activeProvider === "gemini"
      ? "Gemini"
      : byokStatus.activeProvider === "openai"
        ? "OpenAI"
        : byokStatus.activeProvider === "openrouter"
          ? "OpenRouter"
          : "Custom";
  const activeModelShort = activeProviderInfo?.model
    ? activeProviderInfo.model.split("/").pop() || activeProviderInfo.model
    : "";
  const providerLabel = activeModelShort ? `${providerName} · ${activeModelShort}` : providerName;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [directorLog, isPatchingAi]);

  function commitProjectChange(
    updater: (prev: SynkcutProject) => SynkcutProject,
    recordHistory = true
  ) {
    setProject((prev) => {
      const next = updater(prev);
      if (recordHistory) {
        setPastHistory((h) => [...h.slice(-24), prev]);
        setFutureHistory([]);
      }
      return next;
    });
  }

  function handleUndo() {
    if (pastHistory.length === 0) return;
    const previous = pastHistory[pastHistory.length - 1];
    setPastHistory((h) => h.slice(0, -1));
    setFutureHistory((f) => [project, ...f.slice(0, 24)]);
    setProject(previous);
  }

  function handleRedo() {
    if (futureHistory.length === 0) return;
    const next = futureHistory[0];
    setFutureHistory((f) => f.slice(1));
    setPastHistory((h) => [...h.slice(-24), project]);
    setProject(next);
  }

  // Native desktop keyboard shortcuts (Space, Ctrl+Z, Ctrl+Y, Left/Right, Ctrl+Shift+J for JSON)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setShowJsonModal((v) => !v);
        return;
      }

      if (isEditingText || showExportModal || showJsonModal) return;

      if (e.code === "Space") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        handleRedo();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentTimeMs((t) => Math.max(0, t - 250));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentTimeMs((t) => Math.min(totalDurationMs, t + 250));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Debounced auto-save
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setSaveState("dirty");
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        await saveProject(project);
        setSaveState("saved");
        onProjectSaved();
      } catch (err) {
        console.error("Gagal menyimpan proyek otomatis:", err);
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [project, onProjectSaved]);

  // Diagnostics, Audio Pack catalog & export listener
  useEffect(() => {
    checkWebCodecsSupport().then(setWebCodecs);
    checkSidecars().then(setSidecarStatus);
    getAudioPackCatalog().then(setAudioCatalog).catch(() => {});

    let unlisten: (() => void) | null = null;
    listenExportProgress((ev) => {
      setExportPct(ev.percent);
      setExportMessage(ev.message);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
      if (auditionAudioRef.current) {
        auditionAudioRef.current.pause();
        auditionAudioRef.current = null;
      }
    };
  }, []);

  // Resolve cached BGM WAV asset whenever preset changes
  useEffect(() => {
    let cancelled = false;
    const preset = project.globalStyle.bgm.preset;
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current = null;
      setIsAuditioningBgm(false);
    }
    if (!preset || preset === "none" || !isTauriRuntime()) {
      setBgmAssetUrl(null);
      return;
    }
    ensureAudioPackAsset("bgm", preset)
      .then((path) => {
        if (!cancelled) {
          setBgmAssetUrl(path ? toAssetUrl(path) : null);
        }
      })
      .catch(() => {
        if (!cancelled) setBgmAssetUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project.globalStyle.bgm.preset]);

  // Live BGM volume with Auto-Ducking under voiceover
  useEffect(() => {
    const bgmEl = bgmAudioRef.current;
    if (!bgmEl) return;
    const rawVol = project.globalStyle.bgm.volume ?? 0.24;
    const ducked = audioPath && project.globalStyle.bgm.autoDucking ? rawVol * 0.35 : rawVol;
    bgmEl.volume = Math.max(0, Math.min(1, ducked));
  }, [project.globalStyle.bgm.volume, project.globalStyle.bgm.autoDucking, audioPath, bgmAssetUrl]);

  const currentPlayScene = useMemo(() => {
    return (
      project.scenes.find((s) => currentTimeMs >= s.startMs && currentTimeMs < s.endMs) ??
      project.scenes[project.scenes.length - 1] ??
      null
    );
  }, [project.scenes, currentTimeMs]);

  const activeMediaPath = currentPlayScene?.media.path || footagePath;
  const activeSecondaryPath = currentPlayScene?.media.secondaryPath || null;

  // Render 9:16 preview frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const videoEl = videoRef.current;
    if (
      videoEl &&
      activeMediaPath &&
      !isPlaying &&
      videoEl.readyState >= 2 &&
      videoEl.duration > 0
    ) {
      const localSec =
        Math.max(
          0,
          currentTimeMs -
            (currentPlayScene?.startMs ?? 0) +
            (currentPlayScene?.media.trimStartMs ?? 0)
        ) / 1000;
      const targetSec = localSec % videoEl.duration;
      if (Math.abs(videoEl.currentTime - targetSec) > 0.04) {
        videoEl.currentTime = targetSec;
      }
    }

    const secVideoEl = secondaryVideoRef.current;
    if (
      secVideoEl &&
      activeSecondaryPath &&
      !isPlaying &&
      secVideoEl.readyState >= 2 &&
      secVideoEl.duration > 0
    ) {
      const localSec = Math.max(0, currentTimeMs - (currentPlayScene?.startMs ?? 0)) / 1000;
      const targetSec = localSec % secVideoEl.duration;
      if (Math.abs(secVideoEl.currentTime - targetSec) > 0.04) {
        secVideoEl.currentTime = targetSec;
      }
    }

    renderProjectFrame(ctx, project, currentTimeMs, {
      videoElement: activeMediaPath ? videoEl : null,
      secondaryVideoElement: activeSecondaryPath ? secVideoEl : null,
      showSafeZone,
      isPreviewPaused: !isPlaying,
    });
  }, [
    project,
    currentTimeMs,
    showSafeZone,
    activeMediaPath,
    activeSecondaryPath,
    isPlaying,
    currentPlayScene,
  ]);

  // Playback loop + synced audio
  useEffect(() => {
    const audioEl = audioRef.current;
    const bgmEl = bgmAudioRef.current;
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      videoRef.current?.pause();
      secondaryVideoRef.current?.pause();
      audioEl?.pause();
      bgmEl?.pause();
      lastTriggeredSceneIdRef.current = null;
      return;
    }

    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current = null;
      setIsAuditioningBgm(false);
    }

    if (videoRef.current && activeMediaPath) videoRef.current.play().catch(() => {});
    if (secondaryVideoRef.current && activeSecondaryPath) {
      secondaryVideoRef.current.play().catch(() => {});
    }
    if (audioEl && audioPath) {
      const targetAudioSec = currentTimeMs / 1000;
      if (Math.abs(audioEl.currentTime - targetAudioSec) > 0.15) {
        audioEl.currentTime = Math.min(targetAudioSec, audioEl.duration || targetAudioSec);
      }
      audioEl.play().catch(() => {});
    }
    if (bgmEl && bgmAssetUrl) {
      const targetBgmSec = (currentTimeMs / 1000) % (bgmEl.duration || 8);
      if (Math.abs(bgmEl.currentTime - targetBgmSec) > 0.25) {
        bgmEl.currentTime = targetBgmSec;
      }
      bgmEl.play().catch(() => {});
    }

    lastFrameTsRef.current = performance.now();
    const tick = (now: number) => {
      const delta = now - lastFrameTsRef.current;
      lastFrameTsRef.current = now;
      setCurrentTimeMs((prev) => {
        const next = prev + delta;
        if (next >= totalDurationMs) {
          if (videoRef.current) videoRef.current.currentTime = 0;
          if (secondaryVideoRef.current) secondaryVideoRef.current.currentTime = 0;
          if (audioEl) audioEl.currentTime = 0;
          if (bgmEl) bgmEl.currentTime = 0;
          lastTriggeredSceneIdRef.current = null;
          return 0;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, totalDurationMs, activeMediaPath, activeSecondaryPath, audioPath, bgmAssetUrl]);

  // Timed SFX trigger during live preview
  useEffect(() => {
    if (!isPlaying || !currentPlayScene || !isTauriRuntime()) return;
    if (lastTriggeredSceneIdRef.current === currentPlayScene.id) return;
    lastTriggeredSceneIdRef.current = currentPlayScene.id;

    const sfx = currentPlayScene.sfx[0];
    if (!sfx?.preset || sfx.preset === "none") return;

    const cached = sfxCacheRef.current[sfx.preset];
    const playUrl = (url: string) => {
      const a = new Audio(url);
      a.volume = Math.max(0.05, Math.min(1, sfx.volume ?? 0.65));
      a.play().catch(() => {});
    };

    if (cached) {
      playUrl(cached);
    } else {
      ensureAudioPackAsset("sfx", sfx.preset)
        .then((path) => {
          if (!path) return;
          const url = toAssetUrl(path);
          sfxCacheRef.current[sfx.preset] = url;
          playUrl(url);
        })
        .catch(() => {});
    }
  }, [isPlaying, currentPlayScene]);

  // Scrub bar pointer handlers
  function updateTimeFromClientX(clientX: number) {
    const el = scrubBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextMs = Math.round(ratio * totalDurationMs);
    setCurrentTimeMs(nextMs);
    const matching = project.scenes.find((s) => nextMs >= s.startMs && nextMs < s.endMs);
    if (matching) setSelectedSceneId(matching.id);
  }

  function handleScrubPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    setIsPlaying(false);
    isScrubbingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateTimeFromClientX(e.clientX);
  }

  function handleScrubPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isScrubbingRef.current) return;
    updateTimeFromClientX(e.clientX);
  }

  function handleScrubPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    isScrubbingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  /* ---------------- Scene & Media Actions ---------------- */

  async function handlePickFootage(scope: "active" | "all" = "active", logToChat = false) {
    if (isTauriRuntime()) {
      const picked = await pickLocalVideo();
      if (!picked) return;
      const before = project;
      setFootagePath(picked);
      const nextProj: SynkcutProject = {
        ...before,
        scenes: before.scenes.map((s) =>
          scope === "all" || s.id === activeScene?.id
            ? {
                ...s,
                visualSource: "footage",
                media: {
                  ...s.media,
                  path: picked,
                  trimStartMs: scope === "active" ? 0 : s.media.trimStartMs,
                },
              }
            : s
        ),
      };
      commitProjectChange(() => nextProj);
      if (logToChat) {
        const name = picked.split(/[\\/]/).pop() || "video";
        pushDirectorMessage(
          "assistant",
          `Klip "${name}" dipasang ke ${scope === "all" ? "semua scene" : `Scene ${activeSceneIndex + 1}`}.`,
          {
            changes: [`Visual → ${name}`],
            snapshotBefore: before,
          }
        );
      }
      try {
        const info = await probeMedia(picked);
        setFootageProbe(info);
        setClipProbes((prev) => ({ ...prev, [picked]: info }));
        const thumbs = await extractThumbnails(picked, 2);
        setFootageThumbs(thumbs);
      } catch (err) {
        console.error(err);
      }
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/mp4,video/webm,video/quicktime";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const before = project;
        setFootagePath(url);
        const nextProj: SynkcutProject = {
          ...before,
          scenes: before.scenes.map((s) =>
            scope === "all" || s.id === activeScene?.id
              ? { ...s, visualSource: "footage", media: { ...s.media, path: url, trimStartMs: 0 } }
              : s
          ),
        };
        commitProjectChange(() => nextProj);
        if (logToChat) {
          pushDirectorMessage("assistant", `Klip "${file.name}" dipasang ke scene aktif.`, {
            changes: [`Visual → ${file.name}`],
            snapshotBefore: before,
          });
        }
      };
      input.click();
    }
  }

  function assignClipToActiveScene(clipPath: string) {
    if (!activeScene) return;
    commitProjectChange((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id === activeScene.id
          ? { ...s, visualSource: "footage", media: { ...s.media, path: clipPath, trimStartMs: 0 } }
          : s
      ),
    }));
  }

  function updateActiveSceneTrimStart(trimMs: number) {
    if (!activeScene) return;
    commitProjectChange(
      (prev) => ({
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.id === activeScene.id
            ? { ...s, media: { ...s.media, trimStartMs: Math.max(0, Math.round(trimMs)) } }
            : s
        ),
      }),
      false
    );
  }

  function setActiveSceneVisualSource(source: SceneVisualSource) {
    if (!activeScene) return;
    commitProjectChange((prev) => ({
      ...prev,
      version: source === "motion" ? "1.1" : prev.version,
      scenes: prev.scenes.map((s) => {
        if (s.id !== activeScene.id) return s;
        if (source === "motion") {
          return {
            ...s,
            visualSource: "motion",
            aiMotion: s.aiMotion ?? createDefaultAiMotion("flow_diagram", "carbon", s.text),
          };
        }
        return { ...s, visualSource: "footage" };
      }),
    }));
  }

  function updateActiveSceneAiMotion(nextSpec: AiMotionSpec, recordHistory = false) {
    if (!activeScene) return;
    commitProjectChange(
      (prev) => ({
        ...prev,
        version: "1.1",
        scenes: prev.scenes.map((s) =>
          s.id === activeScene.id ? { ...s, visualSource: "motion", aiMotion: nextSpec } : s
        ),
      }),
      recordHistory
    );
  }

  function applyAiMotionThemeToAll(themeOverride?: AiMotionTheme) {
    const activeTheme = themeOverride ?? activeScene?.aiMotion?.theme;
    if (!activeTheme) return;
    commitProjectChange((prev) => ({
      ...prev,
      version: "1.1",
      scenes: prev.scenes.map((s) =>
        s.visualSource === "motion" && s.aiMotion
          ? { ...s, aiMotion: { ...s.aiMotion, theme: activeTheme } }
          : s
      ),
    }));
  }

  function fillAllScenesWithSmartAiMotion(themeChoice: AiMotionTheme = "carbon") {
    const before = project;
    const cycleEngines: AiMotionEngine[] = [
      "flow_diagram",
      "motion_chart",
      "tech_cards",
      "stick_figure",
    ];
    const next: SynkcutProject = {
      ...before,
      version: "1.1",
      scenes: before.scenes.map((s, idx) => {
        const lower = s.text.toLowerCase();
        const eng: AiMotionEngine =
          lower.includes("3d") || lower.includes("smartphone") || lower.includes("laptop")
            ? "breakdown_3d"
            : lower.includes("%") || lower.includes("angka") || lower.includes("grafik")
              ? "motion_chart"
              : lower.includes("analogi") || lower.includes("cerita") || lower.includes("seperti")
                ? "stick_figure"
                : cycleEngines[idx % cycleEngines.length];
        return {
          ...s,
          visualSource: "motion",
          aiMotion: createDefaultAiMotion(eng, themeChoice, s.text),
          motion: { preset: "static_clean", intensity: 0.4 },
          overlays: [],
        };
      }),
    };
    commitProjectChange(() => next);
    setCurrentTimeMs(Math.min(next.scenes[0]?.endMs ? next.scenes[0].endMs * 0.65 : 1800, totalDurationMs));
    pushDirectorMessage(
      "assistant",
      `Semua ${next.scenes.length} scene diisi AI Motion otomatis (Diagram, Chart, Kartu & Stick-Figure) — 0 token.`,
      {
        changes: summarizeProjectDiff(before, next),
        snapshotBefore: before,
      }
    );
  }

  function handleReorderScene(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const movedId = project.scenes[fromIdx]?.id;
    const next = reorderScenes(project, fromIdx, toIdx);
    commitProjectChange(() => next);
    if (movedId) {
      setSelectedSceneId(movedId);
      const relocated = next.scenes.find((s) => s.id === movedId);
      if (relocated) setCurrentTimeMs(relocated.startMs);
    }
  }

  function handleAddScene(role: SceneRole = "body") {
    const { project: next, newSceneId } = addSceneAfter(project, activeScene?.id, role);
    commitProjectChange(() => next);
    setSelectedSceneId(newSceneId);
    const created = next.scenes.find((s) => s.id === newSceneId);
    if (created) setCurrentTimeMs(created.startMs);
  }

  function handleDuplicateScene(sceneId: string) {
    const { project: next, newSceneId } = duplicateScene(project, sceneId);
    commitProjectChange(() => next);
    setSelectedSceneId(newSceneId);
    const created = next.scenes.find((s) => s.id === newSceneId);
    if (created) setCurrentTimeMs(created.startMs);
  }

  function handleDeleteScene(sceneId: string) {
    if (project.scenes.length <= 1) return;
    const idx = project.scenes.findIndex((s) => s.id === sceneId);
    const next = deleteScene(project, sceneId);
    commitProjectChange(() => next);
    const fallback = next.scenes[Math.max(0, Math.min(idx, next.scenes.length - 1))];
    if (fallback) {
      setSelectedSceneId(fallback.id);
      setCurrentTimeMs(fallback.startMs);
    }
  }

  function handleAdjustSceneDuration(sceneId: string, deltaMs: number) {
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const nextDur = Math.max(1000, Math.min(15000, scene.endMs - scene.startMs + deltaMs));
    const next = updateSceneDuration(project, sceneId, nextDur);
    commitProjectChange(() => next);
  }

  function handleChangeSceneRole(sceneId: string, role: SceneRole) {
    commitProjectChange((prev) => updateSceneRole(prev, sceneId, role));
  }

  async function handlePickAudio(logToChat = false) {
    const picked = await pickLocalAudio();
    if (!picked) return;
    const before = project;
    setAudioPath(picked);
    setGenerateDemoAudio(false);
    const next: SynkcutProject = {
      ...before,
      voiceover: { ...before.voiceover, source: "recorded", audioPath: picked },
    };
    commitProjectChange(() => next);
    if (logToChat) {
      const name = picked.split(/[\\/]/).pop() || "audio";
      pushDirectorMessage("assistant", `Voiceover "${name}" dipasang ke proyek.`, {
        changes: [`Voiceover → ${name}`],
        snapshotBefore: before,
      });
    }
  }

  async function handleQuickGenerateTts(logToChat = false) {
    if (!isTauriRuntime() || isGeneratingTts) return;
    const fullText = project.scenes.map((s) => s.text.trim()).filter(Boolean).join(" ");
    if (!fullText) return;
    setIsGeneratingTts(true);
    const before = project;
    try {
      const engine = byokStatus.providers.gemini?.configured
        ? "gemini"
        : byokStatus.providers.openai?.configured
          ? "openai"
          : "windows_offline";
      const voiceName = engine === "openai" ? "nova" : "Kore";
      const res = await generateTtsAudio({
        text: fullText,
        voiceName,
        tone: "santai",
        engine,
      });
      setAudioPath(res.audioPath);
      setGenerateDemoAudio(false);
      const next: SynkcutProject = {
        ...before,
        voiceover: {
          ...before.voiceover,
          source: "tts",
          audioPath: res.audioPath,
          words: res.words.length > 0 ? res.words : before.voiceover.words,
        },
      };
      commitProjectChange(() => next);
      if (logToChat) {
        pushDirectorMessage(
          "assistant",
          `Voiceover TTS selesai dibuat (${res.providerUsed}, ${(res.durationMs / 1000).toFixed(1)} dtk) dan disinkronkan ke subtitle.`,
          {
            changes: [`Voiceover TTS (${res.providerUsed})`],
            snapshotBefore: before,
          }
        );
      }
    } catch (err) {
      if (logToChat) {
        pushDirectorMessage(
          "assistant",
          `Gagal membuat TTS: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      setIsGeneratingTts(false);
    }
  }

  function handleSceneTextChange(sceneId: string, newText: string) {
    commitProjectChange((prev) => {
      const updated: SynkcutProject = {
        ...prev,
        scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, text: newText } : s)),
      };
      return {
        ...updated,
        voiceover: { ...updated.voiceover, words: rebuildWordsFromScenes(updated) },
      };
    }, false);
  }

  function updateActiveSceneMotion(motionPreset: MotionPreset) {
    if (!activeScene) return;
    commitProjectChange((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id === activeScene.id ? { ...s, motion: { ...s.motion, preset: motionPreset } } : s
      ),
    }));
  }

  function updateActiveSceneTransition(transitionPreset: TransitionPreset) {
    if (!activeScene) return;
    commitProjectChange((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id === activeScene.id
          ? {
              ...s,
              transitionIn: {
                preset: transitionPreset,
                durationMs: transitionPreset === "hard_cut" ? 0 : 240,
              },
            }
          : s
      ),
    }));
  }

  function setActiveSceneOverlay(type: "none" | SceneOverlay["type"]) {
    if (!activeScene) return;
    let nextOverlays: SceneOverlay[] = [];
    if (type === "hook_headline") {
      nextOverlays = [
        {
          id: `ov_${Date.now()}`,
          type: "hook_headline",
          text: activeScene.text.slice(0, 48) || "3 Detik Pertama Penentu Views!",
          position: "top",
        },
      ];
    } else if (type === "notification_banner") {
      nextOverlays = [
        {
          id: `ov_${Date.now()}`,
          type: "notification_banner",
          title: "Synkcut · Baru saja",
          text: "Konten siap tayang dalam hitungan menit",
          position: "top",
        },
      ];
    } else if (type === "promo_badge") {
      nextOverlays = [
        {
          id: `ov_${Date.now()}`,
          type: "promo_badge",
          text: "PROMO SPESIAL HARI INI",
          position: "top",
        },
      ];
    } else if (type === "doodle_highlight") {
      nextOverlays = [
        {
          id: `ov_${Date.now()}`,
          type: "doodle_highlight",
          text: "WAJIB TAHU INI!",
          position: "top",
        },
      ];
    } else if (type === "split_screen") {
      nextOverlays = [
        {
          id: `ov_${Date.now()}`,
          type: "split_screen",
          text: "DETAIL B-ROLL",
          position: "center",
        },
      ];
    }

    commitProjectChange((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id === activeScene.id ? { ...s, overlays: nextOverlays } : s
      ),
    }));
  }

  function updateActiveSceneOverlayField(field: "title" | "text", value: string) {
    if (!activeScene || activeScene.overlays.length === 0) return;
    commitProjectChange(
      (prev) => ({
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.id === activeScene.id
            ? {
                ...s,
                overlays: s.overlays.map((ov, idx) =>
                  idx === 0 ? { ...ov, [field]: value } : ov
                ),
              }
            : s
        ),
      }),
      false
    );
  }

  async function handlePickSecondaryFootage() {
    if (!activeScene) return;
    const picked = await pickLocalVideo();
    if (!picked) return;
    commitProjectChange((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id === activeScene.id ? { ...s, media: { ...s.media, secondaryPath: picked } } : s
      ),
    }));
  }

  function clearSecondaryFootage() {
    if (!activeScene) return;
    commitProjectChange((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id === activeScene.id ? { ...s, media: { ...s.media, secondaryPath: null } } : s
      ),
    }));
  }

  function updateActiveSceneSfx(preset: string, volume?: number) {
    if (!activeScene) return;
    const curVol = activeScene.sfx[0]?.volume ?? 0.65;
    const nextSfx =
      !preset || preset === "none" ? [] : [{ preset, offsetMs: 0, volume: volume ?? curVol }];
    commitProjectChange((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => (s.id === activeScene.id ? { ...s, sfx: nextSfx } : s)),
    }));
  }

  async function handleAuditionSfx(presetId: string) {
    if (!presetId || presetId === "none" || !isTauriRuntime()) return;
    try {
      setAuditioningSfxId(presetId);
      let url = sfxCacheRef.current[presetId];
      if (!url) {
        const path = await ensureAudioPackAsset("sfx", presetId);
        if (!path) return;
        url = toAssetUrl(path);
        sfxCacheRef.current[presetId] = url;
      }
      const audio = new Audio(url);
      audio.volume = Math.max(0.1, Math.min(1, activeScene?.sfx[0]?.volume ?? 0.65));
      audio.onended = () => setAuditioningSfxId((cur) => (cur === presetId ? null : cur));
      await audio.play();
    } catch {
      setAuditioningSfxId(null);
    }
  }

  async function handleToggleAuditionBgm() {
    const preset = project.globalStyle.bgm.preset;
    if (isAuditioningBgm && auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current = null;
      setIsAuditioningBgm(false);
      return;
    }
    if (!preset || preset === "none" || !isTauriRuntime()) return;
    try {
      setIsPlaying(false);
      const path = await ensureAudioPackAsset("bgm", preset);
      if (!path) return;
      const audio = new Audio(toAssetUrl(path));
      audio.loop = true;
      audio.volume = Math.max(0.05, Math.min(1, project.globalStyle.bgm.volume ?? 0.24));
      auditionAudioRef.current = audio;
      setIsAuditioningBgm(true);
      await audio.play();
    } catch {
      setIsAuditioningBgm(false);
    }
  }

  /* ---------------- Supercharged AI Director Prompt Engine ---------------- */

  function pushDirectorMessage(
    role: "user" | "assistant",
    text: string,
    extra?: { changes?: string[]; snapshotBefore?: SynkcutProject }
  ) {
    setDirectorLog((prev) => [
      ...prev.slice(-16),
      {
        id: `${Date.now()}_${Math.random()}`,
        role,
        text,
        changes: extra?.changes,
        snapshotBefore: extra?.snapshotBefore,
      },
    ]);
  }

  function handleRevertDirectorPatch(logId: string) {
    const item = directorLog.find((m) => m.id === logId);
    if (!item?.snapshotBefore || item.reverted) return;
    const restored = item.snapshotBefore;
    commitProjectChange(() => restored);
    setDirectorLog((prev) => prev.map((m) => (m.id === logId ? { ...m, reverted: true } : m)));
  }

  async function runDirectorInstruction(rawText: string) {
    const raw = rawText.trim();
    if (!raw || isPatchingAi) return;
    setPromptInput("");
    pushDirectorMessage("user", raw);

    const before = project;
    const lower = raw.toLowerCase();

    // Direct voiceover TTS trigger from chat (works in Tauri!)
    if (
      isTauriRuntime() &&
      (lower.includes("buat suara") ||
        lower.includes("generate suara") ||
        lower.includes("buatkan suara") ||
        lower.includes("generate tts") ||
        lower.includes("voiceover tts"))
    ) {
      await handleQuickGenerateTts(true);
      return;
    }

    // Direct local footage picker from chat
    if (lower.includes("pasang video") || lower.includes("tambah klip") || lower.includes("upload footage")) {
      await handlePickFootage(targetAllScenes ? "all" : "active", true);
      return;
    }

    // When running in Tauri desktop with BYOK configured, invoke real LLM JSON Patching!
    if (isTauriRuntime() && activeByokOk) {
      setIsPatchingAi(true);
      try {
        const focusId = targetAllScenes ? null : (activeScene?.id ?? null);
        const res = await aiCopilotPatch(before, raw, focusId);
        const patched: SynkcutProject = {
          ...res.project,
          voiceover: {
            ...res.project.voiceover,
            words: rebuildWordsFromScenes(res.project),
          },
        };
        commitProjectChange(() => patched);
        pushDirectorMessage("assistant", `${res.reply} (${res.providerUsed})`, {
          changes: summarizeProjectDiff(before, patched),
          snapshotBefore: before,
        });
      } catch (err) {
        pushDirectorMessage(
          "assistant",
          `Gagal memproses revisi AI: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setIsPatchingAi(false);
      }
      return;
    }

    // Zero-token instant local command engine (works offline & in browser preview!)
    const applyLocalPatch = (next: SynkcutProject, reply: string) => {
      commitProjectChange(() => next);
      pushDirectorMessage("assistant", reply, {
        changes: summarizeProjectDiff(before, next),
        snapshotBefore: before,
      });
    };

    if (lower.includes("semua") && (lower.includes("ai motion") || lower.includes("otomatis"))) {
      fillAllScenesWithSmartAiMotion(
        lower.includes("paper") || lower.includes("terang") ? "paper" : "carbon"
      );
    } else if (
      lower.includes("tema paper") ||
      lower.includes("tema terang") ||
      lower.includes("tema mint") ||
      lower.includes("tema coral") ||
      lower.includes("tema blue") ||
      lower.includes("tema biru") ||
      lower.includes("tema carbon") ||
      lower.includes("tema gelap")
    ) {
      const pickedTheme: AiMotionTheme = lower.includes("paper") || lower.includes("terang")
        ? "paper"
        : lower.includes("mint")
          ? "mint"
          : lower.includes("coral")
            ? "coral"
            : lower.includes("blue") || lower.includes("biru")
              ? "blue"
              : "carbon";
      const next: SynkcutProject = {
        ...before,
        version: "1.1",
        globalStyle: lower.includes("lofi") || lower.includes("lo-fi")
          ? { ...before.globalStyle, bgm: { ...before.globalStyle.bgm, preset: "lofi_education" } }
          : before.globalStyle,
        scenes: before.scenes.map((s) =>
          targetAllScenes || lower.includes("semua") || s.id === activeScene?.id
            ? {
                ...s,
                visualSource: "motion",
                aiMotion: s.aiMotion
                  ? { ...s.aiMotion, theme: pickedTheme }
                  : createDefaultAiMotion("flow_diagram", pickedTheme, s.text),
              }
            : s
        ),
      };
      applyLocalPatch(next, `Tema kanvas AI Motion diubah ke ${pickedTheme.toUpperCase()} (0 token).`);
    } else if (lower.includes("hook") && (lower.includes("nendang") || lower.includes("kuat"))) {
      const next: SynkcutProject = {
        ...before,
        globalStyle: { ...before.globalStyle, captionPreset: "bold_pop", accentColor: "#38E59D" },
        scenes: before.scenes.map((s, idx) =>
          idx === 0
            ? {
                ...s,
                motion: { preset: "zoom_punch", intensity: 0.9 },
                overlays:
                  s.visualSource === "motion"
                    ? s.overlays
                    : [
                        {
                          id: `ov_hook_${Date.now()}`,
                          type: "notification_banner",
                          title: "Notifikasi · Baru saja",
                          text: "Hook 3 detik pertama langsung diperkuat",
                          position: "top",
                        },
                      ],
              }
            : s
        ),
      };
      applyLocalPatch(next, "Opening 3 detik pertama diperkuat dengan Bold Pop + Zoom Punch (0 token).");
      setCurrentTimeMs(1000);
    } else if (
      lower.includes("3d") ||
      lower.includes("breakdown") ||
      lower.includes("bedah") ||
      lower.includes("smartphone") ||
      lower.includes("laptop") ||
      lower.includes("earbuds") ||
      lower.includes("smartwatch")
    ) {
      if (activeScene) {
        const presetId = lower.includes("laptop")
          ? "laptop"
          : lower.includes("earbuds")
            ? "earbuds"
            : lower.includes("smartwatch") || lower.includes("jam")
              ? "smartwatch"
              : "smartphone";
        const preset = createBreakdown3DPreset(presetId);
        applyLocalPatch(
          {
            ...before,
            version: "1.1",
            scenes: before.scenes.map((s) =>
              s.id === activeScene.id
                ? {
                    ...s,
                    visualSource: "motion",
                    aiMotion: {
                      engine: "breakdown_3d",
                      theme: activeScene.aiMotion?.theme ?? "carbon",
                      title: preset.title,
                      subtitle: preset.subtitle,
                      takeaway: preset.takeaway,
                      breakdown3d: preset.config,
                    },
                  }
                : s
            ),
          },
          `Scene ${activeSceneIndex + 1} diubah ke 3D Breakdown (${preset.title}) — 0 token.`
        );
      }
    } else if (lower.includes("stick") || lower.includes("kartun") || lower.includes("analogi")) {
      if (activeScene) {
        const nextSpec = createDefaultAiMotion(
          "stick_figure",
          activeScene.aiMotion?.theme ?? "paper",
          activeScene.text
        );
        applyLocalPatch(
          {
            ...before,
            version: "1.1",
            scenes: before.scenes.map((s) =>
              s.id === activeScene.id ? { ...s, visualSource: "motion", aiMotion: nextSpec } : s
            ),
          },
          `Scene ${activeSceneIndex + 1} diubah ke Stick-Figure Story (0 token).`
        );
      }
    } else if (lower.includes("chart") || lower.includes("grafik") || lower.includes("statistik")) {
      if (activeScene) {
        const nextSpec = createDefaultAiMotion(
          "motion_chart",
          activeScene.aiMotion?.theme ?? "carbon",
          activeScene.text
        );
        applyLocalPatch(
          {
            ...before,
            version: "1.1",
            scenes: before.scenes.map((s) =>
              s.id === activeScene.id ? { ...s, visualSource: "motion", aiMotion: nextSpec } : s
            ),
          },
          `Scene ${activeSceneIndex + 1} diubah ke Motion Chart (0 token).`
        );
      }
    } else if (
      lower.includes("kartu") ||
      lower.includes("kode") ||
      lower.includes("terminal") ||
      lower.includes("banding")
    ) {
      if (activeScene) {
        const nextSpec = createDefaultAiMotion(
          "tech_cards",
          activeScene.aiMotion?.theme ?? "blue",
          activeScene.text
        );
        if (lower.includes("kode") || lower.includes("terminal")) {
          if (nextSpec.techCards) nextSpec.techCards.layout = "terminal_code";
        } else if (lower.includes("banding")) {
          if (nextSpec.techCards) nextSpec.techCards.layout = "comparison_split";
        }
        applyLocalPatch(
          {
            ...before,
            version: "1.1",
            scenes: before.scenes.map((s) =>
              s.id === activeScene.id ? { ...s, visualSource: "motion", aiMotion: nextSpec } : s
            ),
          },
          `Scene ${activeSceneIndex + 1} diubah ke Tech & UI Cards (0 token).`
        );
      }
    } else if (
      lower.includes("ai motion") ||
      lower.includes("diagram") ||
      lower.includes("flow") ||
      lower.includes("siklus")
    ) {
      if (activeScene) {
        const nextSpec = createDefaultAiMotion(
          "flow_diagram",
          activeScene.aiMotion?.theme ?? "carbon",
          activeScene.text
        );
        if (lower.includes("siklus") && nextSpec.flow) nextSpec.flow.pattern = "cycle";
        applyLocalPatch(
          {
            ...before,
            version: "1.1",
            scenes: before.scenes.map((s) =>
              s.id === activeScene.id ? { ...s, visualSource: "motion", aiMotion: nextSpec } : s
            ),
          },
          `Scene ${activeSceneIndex + 1} diubah ke Flow & Diagram (0 token).`
        );
      }
    } else if (lower.includes("footage") || lower.includes("video lokal")) {
      if (activeScene) {
        applyLocalPatch(
          {
            ...before,
            scenes: before.scenes.map((s) =>
              s.id === activeScene.id ? { ...s, visualSource: "footage" } : s
            ),
          },
          `Scene ${activeSceneIndex + 1} dikembalikan ke mode Footage Lokal (0 token).`
        );
      }
    } else if (lower.includes("editorial") || lower.includes("luxury") || lower.includes("serif")) {
      applyLocalPatch(
        {
          ...before,
          globalStyle: {
            ...before.globalStyle,
            captionPreset: "luxury_editorial",
            accentColor: "#F59E0B",
          },
        },
        "Style caption diubah ke Luxury Editorial (serif + aksen emas)."
      );
    } else if (lower.includes("neon")) {
      applyLocalPatch(
        {
          ...before,
          globalStyle: { ...before.globalStyle, captionPreset: "neon_tech", accentColor: "#38E59D" },
        },
        "Style caption diubah ke Neon Tech dengan aksen Emerald."
      );
    } else if (lower.includes("minimal") || lower.includes("clean")) {
      applyLocalPatch(
        {
          ...before,
          globalStyle: {
            ...before.globalStyle,
            captionPreset: "clean_minimal",
            accentColor: "#38BDF8",
          },
        },
        "Style diubah ke Clean Minimal dengan aksen Cyan."
      );
    } else if (lower.includes("kinetic")) {
      applyLocalPatch(
        {
          ...before,
          globalStyle: {
            ...before.globalStyle,
            captionPreset: "kinetic_punch",
            accentColor: "#38E59D",
          },
        },
        "Style caption diubah ke Kinetic Punch (2 kata besar per hentakan)."
      );
    } else if (lower.includes("tambah scene")) {
      const { project: next, newSceneId } = addSceneAfter(before, activeScene?.id, "body");
      applyLocalPatch(next, "Scene baru ditambahkan setelah scene aktif.");
      setSelectedSceneId(newSceneId);
    } else if (lower.includes("hapus scene") && before.scenes.length > 1 && activeScene) {
      const next = deleteScene(before, activeScene.id);
      applyLocalPatch(next, `Scene ${activeSceneIndex + 1} dihapus.`);
      if (next.scenes[0]) setSelectedSceneId(next.scenes[0].id);
    } else if (lower.includes("hapus overlay") || lower.includes("tanpa overlay")) {
      setActiveSceneOverlay("none");
      pushDirectorMessage("assistant", "Overlay dihapus dari scene aktif.", {
        changes: [`Scene ${activeSceneIndex + 1} Overlay → Dihapus`],
        snapshotBefore: before,
      });
    } else if (lower.includes("notif")) {
      setActiveSceneOverlay("notification_banner");
      pushDirectorMessage("assistant", "Notifikasi pop-up ditambahkan ke scene aktif.", {
        changes: [`Scene ${activeSceneIndex + 1} Overlay → Notif Banner`],
        snapshotBefore: before,
      });
    } else if (lower.includes("doodle") || lower.includes("spidol")) {
      setActiveSceneOverlay("doodle_highlight");
      pushDirectorMessage("assistant", "Doodle Marker ditambahkan ke scene aktif.", {
        changes: [`Scene ${activeSceneIndex + 1} Overlay → Doodle Marker`],
        snapshotBefore: before,
      });
    } else if (lower.includes("lofi") || lower.includes("lo-fi")) {
      applyLocalPatch(
        {
          ...before,
          globalStyle: {
            ...before.globalStyle,
            bgm: { ...before.globalStyle.bgm, preset: "lofi_education" },
          },
        },
        "Backsound diganti ke Lo-Fi Edukasi dengan Auto-Ducking."
      );
    } else if (lower.includes("tanpa bgm") || lower.includes("hapus bgm") || lower.includes("matikan musik")) {
      applyLocalPatch(
        {
          ...before,
          globalStyle: {
            ...before.globalStyle,
            bgm: { ...before.globalStyle.bgm, preset: "none" },
          },
        },
        "Backsound (BGM) dimatikan."
      );
    } else {
      pushDirectorMessage(
        "assistant",
        "Atur API Key BYOK di Pengaturan AI agar AI Director bisa mengeksekusi arahan bebas (atau coba perintah cepat: '3d smartphone', 'grafik', 'diagram', 'stick figure', 'tema paper', 'lofi', 'editorial', 'tambah scene')."
      );
    }
  }

  async function handleDirectorPromptSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runDirectorInstruction(promptInput);
  }

  /* ---------------- Export Pipeline ---------------- */

  function handleCancelExport() {
    exportAbortRef.current?.abort();
  }

  async function handleExport() {
    setExportError(null);
    setExportResult(null);

    const safeSlug =
      project.meta.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "") || "synkcut_export";

    const savePath = await pickExportSavePath(`${safeSlug}_9x16`);
    if (!savePath) return;

    const controller = new AbortController();
    exportAbortRef.current = controller;

    setIsPlaying(false);
    setIsExporting(true);
    setExportStage("init");
    setExportPct(0);
    setExportElapsedMs(0);
    setExportEtaMs(null);
    setExportMessage("Memulai pipeline export...");

    try {
      const result = await exportProjectToMp4(project, {
        resolution,
        fps: exportFps,
        audioPath,
        generateDemoAudio,
        outputPath: savePath,
        videoElement: footagePath ? videoRef.current : null,
        signal: controller.signal,
        onProgress: (upd) => {
          setExportPct(upd.percent);
          setExportStage(upd.stage);
          setExportMessage(upd.message);
          if (upd.elapsedMs !== undefined) setExportElapsedMs(upd.elapsedMs);
          if (upd.etaMs !== undefined) setExportEtaMs(upd.etaMs);
        },
      });
      setExportStage("done");
      setExportResult(result);
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        setExportStage("idle");
        setExportPct(0);
        setExportEtaMs(null);
        setExportMessage("Export dibatalkan.");
      } else {
        setExportError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      exportAbortRef.current = null;
      setIsExporting(false);
    }
  }

  const roleColor = (role: "hook" | "body" | "cta") => {
    if (role === "hook") return "var(--role-hook)";
    if (role === "body") return "var(--role-body)";
    return "var(--role-cta)";
  };

  const playheadPercent = Math.max(0, Math.min(100, (currentTimeMs / totalDurationMs) * 100));

  const starterPrompts = useMemo(() => {
    if (!hasAnyFootage && !hasAnyMotion) {
      return [
        {
          label: "Isi semua scene pakai AI Motion otomatis",
          prompt: "Isi semua scene pakai AI Motion otomatis",
        },
        {
          label: "Jadikan scene ini bedah 3D Smartphone",
          prompt: "Jadikan scene ini bedah 3D smartphone",
        },
        {
          label: "Ubah scene ini jadi grafik batang / chart",
          prompt: "Ubah scene ini jadi grafik batang chart",
        },
        {
          label: "Ganti gaya ke Luxury Editorial + Lo-Fi",
          prompt: "Ganti gaya ke luxury editorial",
        },
      ];
    }
    return [
      {
        label: "Ubah scene ini jadi grafik batang / chart",
        prompt: "Ubah scene ini jadi grafik batang chart",
      },
      {
        label: "Jadikan scene ini animasi 3D Laptop",
        prompt: "Jadikan scene ini animasi 3D laptop",
      },
      {
        label: "Ganti suasana ke tema Paper + BGM Lo-Fi",
        prompt: "Ganti semua ke tema paper dan musik lofi",
      },
      {
        label: "Perkuat hook 3 detik pertama biar nendang",
        prompt: "Bikin hook 3 detik pertama lebih nendang",
      },
    ];
  }, [hasAnyFootage, hasAnyMotion]);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      {/* Hidden Media Elements */}
      {activeMediaPath && (
        <video
          ref={videoRef}
          src={toAssetUrl(activeMediaPath)}
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          className="hidden"
          onLoadedData={() => setCurrentTimeMs((t) => t)}
        />
      )}
      {activeSecondaryPath && (
        <video
          ref={secondaryVideoRef}
          src={toAssetUrl(activeSecondaryPath)}
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          className="hidden"
          onLoadedData={() => setCurrentTimeMs((t) => t)}
        />
      )}
      {audioPath && (
        <audio ref={audioRef} src={toAssetUrl(audioPath)} preload="auto" className="hidden" />
      )}
      {bgmAssetUrl && (
        <audio ref={bgmAudioRef} src={bgmAssetUrl} loop preload="auto" className="hidden" />
      )}

      {/* ULTRA-CLEAN TOP BAR (5 Essential Controls) */}
      <header
        className="flex h-[52px] shrink-0 items-center justify-between border-b px-4"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBackHome}
            className="ui-btn-secondary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Projects
          </button>

          <input
            type="text"
            value={project.meta.name}
            onChange={(e) =>
              commitProjectChange(
                (prev) => ({ ...prev, meta: { ...prev.meta, name: e.target.value } }),
                false
              )
            }
            aria-label="Nama proyek"
            className="min-w-0 max-w-[260px] rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-[var(--border-subtle)] focus:border-[var(--border-strong)]"
          />

          <span
            className="hidden shrink-0 items-center gap-1 text-xs md:inline-flex"
            style={{ color: "var(--text-muted)" }}
          >
            <Check className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />
            {saveState === "saving"
              ? "Menyimpan..."
              : saveState === "dirty"
                ? "Mengubah..."
                : "Tersimpan"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Undo / Redo */}
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              disabled={pastHistory.length === 0}
              onClick={handleUndo}
              className="ui-btn-secondary flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-35 cursor-pointer"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={futureHistory.length === 0}
              onClick={handleRedo}
              className="ui-btn-secondary flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-35 cursor-pointer"
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* On-Demand Manual Tweaks Drawer Toggle (Hidden by default!) */}
          <button
            type="button"
            onClick={() => setShowManualDrawer((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors cursor-pointer"
            style={{
              backgroundColor: showManualDrawer ? "var(--accent-soft)" : "var(--bg-elevated)",
              color: showManualDrawer ? "var(--accent)" : "var(--text-primary)",
              border: showManualDrawer
                ? "1px solid var(--accent)"
                : "1px solid var(--border-subtle)",
            }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Atur Manual
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            className="ui-btn-secondary flex h-8 w-8 items-center justify-center rounded-md cursor-pointer"
            title={theme === "dark" ? "Ganti ke Light Studio" : "Ganti ke Dark Studio"}
            aria-label="Ganti tema Dark atau Light Studio"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="ui-btn-primary inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export MP4
          </button>
        </div>
      </header>

      {/* MAIN 2-COLUMN LOVABLE PROMPT-FIRST WORKSPACE */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* 1. LEFT HERO COLUMN: AI DIRECTOR CHAT (ALA LOVABLE) */}
        <section
          className="flex w-[400px] shrink-0 flex-col border-r lg:w-[420px]"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {/* Minimal AI Director Header */}
          <div
            className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <h1 className="text-sm font-bold tracking-tight">AI Director</h1>
            <span
              className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium"
              style={{ color: "var(--text-secondary)" }}
              title={activeByokOk ? providerLabel : "Mode Cepat (0 Token)"}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: activeByokOk ? "var(--success)" : "var(--text-muted)" }}
              />
              <span className="truncate">
                {activeByokOk ? providerLabel : "Mode Cepat (0 Token)"}
              </span>
            </span>
          </div>

          {/* Spacious Chat Thread */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {directorLog.length === 0 ? (
              <div className="flex h-full flex-col justify-center">
                <div className="space-y-2">
                  <h2 className="text-lg font-bold tracking-tight">
                    Mau ubah apa di video ini?
                  </h2>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    Cukup ketik perintah pakai bahasa sehari-hari. AI akan langsung mengubah visual,
                    animasi 2D/3D, caption, atau musik di preview sebelah kanan.
                  </p>
                </div>

                {/* Clean Flat Prompt Starters (Zero nested card borders) */}
                <div
                  className="mt-6 divide-y border-t border-b"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  {starterPrompts.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => runDirectorInstruction(item.prompt)}
                      className="ui-row flex w-full items-center justify-between gap-3 py-3 text-left text-xs font-medium transition-colors cursor-pointer"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span>{item.label}</span>
                      <ArrowUp
                        className="h-3.5 w-3.5 shrink-0 rotate-45"
                        style={{ color: "var(--text-muted)" }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {directorLog.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={
                        msg.role === "user"
                          ? "max-w-[88%] rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed"
                          : "w-full space-y-2 text-sm leading-relaxed"
                      }
                      style={
                        msg.role === "user"
                          ? {
                              backgroundColor: "var(--accent-soft)",
                              color: "var(--text-primary)",
                            }
                          : { color: "var(--text-primary)" }
                      }
                    >
                      <div>{msg.text}</div>

                      {msg.changes && msg.changes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {msg.changes.map((chg, idx) => (
                            <span
                              key={idx}
                              className="rounded-md px-2 py-0.5 text-xs font-medium"
                              style={{
                                backgroundColor: "var(--bg-elevated)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {chg}
                            </span>
                          ))}
                        </div>
                      )}

                      {msg.role === "assistant" && msg.snapshotBefore && (
                        <div className="pt-0.5">
                          {msg.reverted ? (
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              Perubahan sudah dibatalkan
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRevertDirectorPatch(msg.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium hover:underline cursor-pointer"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              Batalkan perubahan ini
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isPatchingAi && (
                  <div
                    className="inline-flex items-center gap-2 text-xs font-medium"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--accent)" }} />
                    AI Director sedang menyunting video...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Bottom Lovable Unified Prompt Composer */}
          <div
            className="shrink-0 border-t px-4 py-3.5 space-y-2.5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {/* Scene Focus Scope Toggle */}
            {activeScene && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span
                  className="inline-flex items-center gap-1.5 font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: targetAllScenes ? "var(--accent)" : roleColor(activeScene.role),
                    }}
                  />
                  {targetAllScenes
                    ? `Target: Semua Scene (${project.scenes.length})`
                    : `Fokus: Scene ${activeSceneIndex + 1} · ${activeScene.role.toUpperCase()}`}
                </span>
                <button
                  type="button"
                  onClick={() => setTargetAllScenes((v) => !v)}
                  className="text-xs font-medium hover:underline cursor-pointer"
                  style={{ color: "var(--text-muted)" }}
                >
                  {targetAllScenes ? "Fokus scene aktif" : "Ubah semua scene"}
                </button>
              </div>
            )}

            <form
              onSubmit={handleDirectorPromptSubmit}
              className="rounded-xl p-3 space-y-2.5"
              style={{
                backgroundColor: "var(--bg-app)",
                border: "1px solid var(--border-strong)",
              }}
            >
              <textarea
                rows={2}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleDirectorPromptSubmit(e);
                  }
                }}
                placeholder="Suruh AI ubah video... mis. ubah ke 3D smartphone, ganti grafik, atau musik lo-fi"
                className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
                style={{ color: "var(--text-primary)" }}
              />

              <div className="flex items-center justify-between gap-2">
                {/* Inline Quick Attachment & Mode Actions */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handlePickFootage(targetAllScenes ? "all" : "active", true)}
                    className="ui-btn-secondary inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium cursor-pointer"
                    title="Lampirkan klip video lokal"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Klip
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      isTauriRuntime() ? handlePickAudio(true) : setShowManualDrawer(true)
                    }
                    className="ui-btn-secondary inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium cursor-pointer"
                    title="Pasang file suara / voiceover"
                  >
                    <Music className="h-3.5 w-3.5" />
                    Suara
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeScene?.visualSource === "motion") {
                        setManualTab("visual");
                        setShowManualDrawer(true);
                      } else {
                        setActiveSceneVisualSource("motion");
                        pushDirectorMessage(
                          "assistant",
                          `Scene ${activeSceneIndex + 1} diaktifkan ke mode AI Motion. Ketik tipe animasi yang diinginkan (diagram, chart, kartu, stick figure, atau 3D).`
                        );
                      }
                    }}
                    className="ui-btn-secondary inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium cursor-pointer"
                    title="Aktifkan atau atur AI Motion"
                  >
                    <Shapes className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                    AI Motion
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={!promptInput.trim() || isPatchingAi}
                  className="ui-btn-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-35 cursor-pointer"
                  aria-label="Kirim perintah ke AI Director"
                >
                  {isPatchingAi ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* 2. RIGHT HERO COLUMN: 9:16 VIDEO STAGE + SINGLE UNIFIED SCENE STRIP */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Spacious 9:16 Preview Stage */}
          <div className="ui-stage-grid relative flex min-h-0 flex-1 flex-col items-center justify-center p-5">
            {/* Subtle Floating Stage Status (Top-Left & Top-Right — zero heavy bar) */}
            <div className="pointer-events-none absolute top-3.5 right-4 left-4 flex items-center justify-between">
              <div className="pointer-events-auto flex items-center gap-2">
                {activeScene && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: roleColor(activeScene.role) }}
                    />
                    Scene {activeSceneIndex + 1} · {activeScene.role.toUpperCase()}
                    {activeScene.visualSource === "motion" && (
                      <span style={{ color: "var(--accent)" }}>
                        ·{" "}
                        {AI_MOTION_ENGINES.find((e) => e.id === activeScene.aiMotion?.engine)
                          ?.label ?? "AI Motion"}
                      </span>
                    )}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowSafeZone((v) => !v)}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: showSafeZone ? "var(--accent-soft)" : "var(--bg-panel)",
                  border: showSafeZone
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border-subtle)",
                  color: showSafeZone ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                <Shield className="h-3.5 w-3.5" />
                Safe Zone
              </button>
            </div>

            {/* Hero 9:16 Video Canvas */}
            <canvas
              ref={canvasRef}
              width={1080}
              height={1920}
              className="max-h-full w-auto rounded-2xl"
              style={{
                aspectRatio: "9 / 16",
                border: "1px solid var(--border-strong)",
                boxShadow: "0 18px 44px rgba(0, 0, 0, 0.28)",
                backgroundColor: "#090b0f",
              }}
            />
          </div>

          {/* Clean Transport + Unified Scene Strip */}
          <div
            className="shrink-0 border-t px-5 py-3 space-y-2.5"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {/* Playback Transport + Quick Edit Trigger */}
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono-num text-xs" style={{ color: "var(--text-secondary)" }}>
                <strong style={{ color: "var(--text-primary)" }}>
                  {formatTimecode(currentTimeMs)}
                </strong>{" "}
                / {formatTimecode(totalDurationMs)}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentTimeMs(0);
                  }}
                  className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded-full cursor-pointer"
                  title="Ulang dari 00:00"
                  aria-label="Ulang dari awal"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  className="ui-btn-primary flex h-9 w-9 items-center justify-center rounded-full cursor-pointer"
                  aria-label={isPlaying ? "Pause preview" : "Play preview"}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setManualTab("style");
                  setShowManualDrawer(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit Teks & Durasi
              </button>
            </div>

            {/* Interactive Thin Scrub Progress Bar */}
            <div
              ref={scrubBarRef}
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              className="relative flex h-3 w-full items-center cursor-ew-resize select-none"
              role="slider"
              aria-label="Scrub timeline video"
              aria-valuemin={0}
              aria-valuemax={totalDurationMs}
              aria-valuenow={Math.round(currentTimeMs)}
            >
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--bg-elevated)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${playheadPercent}%`,
                    backgroundColor: "var(--accent)",
                  }}
                />
              </div>
              <div
                className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full shadow"
                style={{
                  left: `${playheadPercent}%`,
                  backgroundColor: "var(--accent)",
                  border: "2px solid var(--bg-panel)",
                }}
              />
            </div>

            {/* Single Unified Scene Strip (Draggable, Click to Focus AI, + Add) */}
            <div className="flex items-stretch gap-1.5">
              {project.scenes.map((scene, idx) => {
                const widthPct = ((scene.endMs - scene.startMs) / totalDurationMs) * 100;
                const isSelected = activeScene?.id === scene.id;
                const isDragOver = dragOverSceneIdx === idx && draggedSceneIdx !== idx;
                const durSec = ((scene.endMs - scene.startMs) / 1000).toFixed(1);
                return (
                  <button
                    key={scene.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      setDraggedSceneIdx(idx);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOverSceneIdx !== idx) setDragOverSceneIdx(idx);
                    }}
                    onDragLeave={() => {
                      if (dragOverSceneIdx === idx) setDragOverSceneIdx(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedSceneIdx !== null && draggedSceneIdx !== idx) {
                        handleReorderScene(draggedSceneIdx, idx);
                      }
                      setDraggedSceneIdx(null);
                      setDragOverSceneIdx(null);
                    }}
                    onDragEnd={() => {
                      setDraggedSceneIdx(null);
                      setDragOverSceneIdx(null);
                    }}
                    onClick={() => {
                      setSelectedSceneId(scene.id);
                      setTargetAllScenes(false);
                      setCurrentTimeMs(scene.startMs);
                    }}
                    style={{
                      width: `${widthPct}%`,
                      minWidth: "88px",
                      backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-elevated)",
                      border: isDragOver
                        ? "1px solid var(--accent)"
                        : isSelected
                          ? "1px solid var(--border-strong)"
                          : "1px solid var(--border-subtle)",
                      opacity: draggedSceneIdx === idx ? 0.5 : 1,
                    }}
                    className="flex flex-col justify-between overflow-hidden rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-1 text-xs font-semibold">
                      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: roleColor(scene.role) }}
                        />
                        <span className="truncate uppercase">
                          {idx + 1}. {scene.role}
                        </span>
                      </span>
                      <span
                        className="shrink-0 inline-flex items-center gap-1 font-mono-num text-xs font-normal"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {scene.visualSource === "motion" && (
                          <Shapes className="h-3 w-3" style={{ color: "var(--accent)" }} />
                        )}
                        {durSec}s
                      </span>
                    </div>
                    <div
                      className="mt-0.5 truncate text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {scene.text}
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => handleAddScene("body")}
                className="ui-btn-secondary flex w-10 shrink-0 items-center justify-center rounded-lg cursor-pointer"
                title="Tambah scene baru"
                aria-label="Tambah scene baru"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* 3. ON-DEMAND SLIDE-OVER DRAWER: ATUR MANUAL (0 TOKEN AI) — HIDDEN BY DEFAULT */}
        {showManualDrawer && (
          <aside
            className="flex w-[332px] shrink-0 flex-col border-l"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {/* Drawer Header */}
            <div
              className="flex h-11 shrink-0 items-center justify-between border-b px-4"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">Atur Manual</h2>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  0 token AI
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowManualDrawer(false)}
                className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                aria-label="Tutup panel manual"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 3 Consolidated Tabs (Visual / Teks & Gaya / Suara) */}
            <div
              className="grid shrink-0 grid-cols-3 gap-1 border-b p-2"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {[
                { id: "visual" as const, label: "Visual", icon: Layers },
                { id: "style" as const, label: "Teks & Gaya", icon: Pencil },
                { id: "audio" as const, label: "Suara", icon: Volume2 },
              ].map((t) => {
                const Icon = t.icon;
                const active = manualTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setManualTab(t.id)}
                    className="inline-flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                    style={{
                      backgroundColor: active ? "var(--bg-elevated)" : "transparent",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      border: active
                        ? "1px solid var(--border-strong)"
                        : "1px solid transparent",
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Active Scene Quick Stepper Bar inside Drawer */}
            {activeScene && (
              <div
                className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2 text-xs"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={activeSceneIndex <= 0}
                    onClick={() => {
                      const prev = project.scenes[activeSceneIndex - 1];
                      if (prev) {
                        setSelectedSceneId(prev.id);
                        setCurrentTimeMs(prev.startMs);
                      }
                    }}
                    className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded disabled:opacity-35 cursor-pointer"
                    aria-label="Scene sebelumnya"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-1 font-bold uppercase" style={{ color: roleColor(activeScene.role) }}>
                    {activeSceneIndex + 1}/{project.scenes.length} · {activeScene.role}
                  </span>
                  <button
                    type="button"
                    disabled={activeSceneIndex >= project.scenes.length - 1}
                    onClick={() => {
                      const next = project.scenes[activeSceneIndex + 1];
                      if (next) {
                        setSelectedSceneId(next.id);
                        setCurrentTimeMs(next.startMs);
                      }
                    }}
                    className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded disabled:opacity-35 cursor-pointer"
                    aria-label="Scene berikutnya"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDuplicateScene(activeScene.id)}
                    className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                    title="Duplikat scene"
                    aria-label="Duplikat scene"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={project.scenes.length <= 1}
                    onClick={() => handleDeleteScene(activeScene.id)}
                    className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded disabled:opacity-35 cursor-pointer"
                    style={{ color: "var(--danger)" }}
                    title="Hapus scene"
                    aria-label="Hapus scene"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Drawer Scroll Body */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              {/* MANUAL TAB 1: VISUAL (FOOTAGE LOKAL <-> AI MOTION) */}
              {manualTab === "visual" && activeScene && (
                <div className="space-y-3.5">
                  <div
                    className="grid grid-cols-2 gap-1 rounded-lg p-1"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveSceneVisualSource("footage")}
                      className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                      style={{
                        backgroundColor:
                          activeScene.visualSource !== "motion"
                            ? "var(--bg-panel)"
                            : "transparent",
                        color:
                          activeScene.visualSource !== "motion"
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                        border:
                          activeScene.visualSource !== "motion"
                            ? "1px solid var(--border-strong)"
                            : "1px solid transparent",
                      }}
                    >
                      <Film className="h-3.5 w-3.5" />
                      Footage Lokal
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSceneVisualSource("motion")}
                      className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                      style={{
                        backgroundColor:
                          activeScene.visualSource === "motion"
                            ? "var(--bg-panel)"
                            : "transparent",
                        color:
                          activeScene.visualSource === "motion"
                            ? "var(--accent)"
                            : "var(--text-secondary)",
                        border:
                          activeScene.visualSource === "motion"
                            ? "1px solid var(--accent)"
                            : "1px solid transparent",
                      }}
                    >
                      <Shapes className="h-3.5 w-3.5" />
                      AI Motion
                    </button>
                  </div>

                  {activeScene.visualSource === "motion" ? (
                    <div className="space-y-3">
                      <AiMotionEditor
                        spec={
                          activeScene.aiMotion ??
                          createDefaultAiMotion("flow_diagram", "carbon", activeScene.text)
                        }
                        sceneText={activeScene.text}
                        onChange={updateActiveSceneAiMotion}
                      />
                      {project.scenes.filter((s) => s.visualSource === "motion").length > 1 && (
                        <button
                          type="button"
                          onClick={() => applyAiMotionThemeToAll()}
                          className="ui-btn-secondary flex w-full items-center justify-center rounded-md py-2 text-xs font-semibold cursor-pointer"
                        >
                          Samakan Tema ke Semua AI Motion
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => handlePickFootage("active")}
                        className="ui-btn-primary flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold cursor-pointer"
                      >
                        <Upload className="h-4 w-4" />
                        {activeScene.media.path
                          ? "Ganti Footage Scene Ini"
                          : "Pilih Footage untuk Scene Ini"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handlePickFootage("all")}
                        className="ui-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium cursor-pointer"
                      >
                        <Film className="h-3.5 w-3.5" />
                        Pasang 1 Footage ke Semua Scene
                      </button>

                      {activeScene.media.path && (
                        <div
                          className="space-y-2.5 border-t pt-3"
                          style={{ borderColor: "var(--border-subtle)" }}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span
                              className="truncate font-mono-num font-semibold"
                              title={activeScene.media.path}
                            >
                              {activeScene.media.path.split(/[\\/]/).pop()}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                commitProjectChange((prev) => ({
                                  ...prev,
                                  scenes: prev.scenes.map((s) =>
                                    s.id === activeScene.id
                                      ? { ...s, media: { ...s.media, path: null, trimStartMs: 0 } }
                                      : s
                                  ),
                                }))
                              }
                              className="shrink-0 text-xs underline cursor-pointer"
                              style={{ color: "var(--text-muted)" }}
                            >
                              Lepas
                            </button>
                          </div>

                          <div>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span style={{ color: "var(--text-secondary)" }}>Mulai Klip</span>
                              <span className="font-mono-num" style={{ color: "var(--text-muted)" }}>
                                {formatTimecode(activeScene.media.trimStartMs || 0)}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={Math.max(
                                10000,
                                (clipProbes[activeScene.media.path]?.durationMs ??
                                  footageProbe?.durationMs ??
                                  20000) - 1000
                              )}
                              step={200}
                              value={activeScene.media.trimStartMs || 0}
                              onChange={(e) => updateActiveSceneTrimStart(Number(e.target.value))}
                              className="w-full accent-[var(--accent)] cursor-pointer"
                            />
                          </div>
                        </div>
                      )}

                      {projectClipPaths.length > 0 && (
                        <div className="space-y-1.5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                          <div className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                            Klip di Proyek ({projectClipPaths.length})
                          </div>
                          {projectClipPaths.map((clipPath) => {
                            const isCurrent = activeScene.media.path === clipPath;
                            return (
                              <div
                                key={clipPath}
                                className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs"
                                style={{
                                  backgroundColor: isCurrent
                                    ? "var(--accent-soft)"
                                    : "var(--bg-elevated)",
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate font-mono-num">
                                  {clipPath.split(/[\\/]/).pop()}
                                </span>
                                {isCurrent ? (
                                  <span className="shrink-0 font-semibold" style={{ color: "var(--accent)" }}>
                                    Aktif
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => assignClipToActiveScene(clipPath)}
                                    className="ui-btn-secondary shrink-0 rounded px-2 py-0.5 text-xs font-medium cursor-pointer"
                                  >
                                    Pakai
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {footageThumbs.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {footageThumbs.map((src, i) => (
                            <img
                              key={i}
                              src={src}
                              alt={`Thumbnail ${i + 1}`}
                              className="h-20 w-full rounded object-cover"
                              style={{ border: "1px solid var(--border-subtle)" }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* MANUAL TAB 2: TEKS, DURASI, CAPTION, MOTION & OVERLAY */}
              {manualTab === "style" && activeScene && (
                <div className="space-y-4">
                  {/* Inline Script & Duration */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={activeScene.role}
                        onChange={(e) =>
                          handleChangeSceneRole(activeScene.id, e.target.value as SceneRole)
                        }
                        aria-label="Peran scene"
                        className="ui-input rounded-md px-2 py-1 text-xs font-bold uppercase"
                      >
                        <option value="hook">HOOK</option>
                        <option value="body">BODY</option>
                        <option value="cta">CTA</option>
                      </select>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleAdjustSceneDuration(activeScene.id, -500)}
                          className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                          aria-label="Kurangi durasi"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="min-w-[40px] text-center font-mono-num text-xs font-semibold">
                          {((activeScene.endMs - activeScene.startMs) / 1000).toFixed(1)}s
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAdjustSceneDuration(activeScene.id, 500)}
                          className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                          aria-label="Tambah durasi"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={3}
                      value={activeScene.text}
                      onChange={(e) => handleSceneTextChange(activeScene.id, e.target.value)}
                      className="ui-input w-full resize-none rounded-md p-2.5 text-xs leading-relaxed"
                    />
                  </div>

                  {/* Caption Style & Accent Color */}
                  <div className="space-y-2.5 border-t pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                    <label className="block text-xs font-semibold">Style Kinetic Caption</label>
                    <select
                      value={project.globalStyle.captionPreset}
                      onChange={(e) =>
                        commitProjectChange((prev) => ({
                          ...prev,
                          globalStyle: {
                            ...prev.globalStyle,
                            captionPreset: e.target.value as CaptionPreset,
                          },
                        }))
                      }
                      className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                    >
                      {CAPTION_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} — {p.sample}
                        </option>
                      ))}
                    </select>

                    <div>
                      <div className="mb-1.5 text-xs font-semibold">Warna Sorotan Kata</div>
                      <div className="flex items-center gap-2">
                        {ACCENT_SWATCHES.map((hex) => {
                          const active =
                            project.globalStyle.accentColor.toUpperCase() === hex.toUpperCase();
                          return (
                            <button
                              key={hex}
                              type="button"
                              onClick={() =>
                                commitProjectChange((prev) => ({
                                  ...prev,
                                  globalStyle: { ...prev.globalStyle, accentColor: hex },
                                }))
                              }
                              className="h-7 w-7 rounded-full cursor-pointer"
                              style={{
                                backgroundColor: hex,
                                border: active
                                  ? "2px solid var(--text-primary)"
                                  : "1px solid var(--border-strong)",
                              }}
                              aria-label={`Pilih warna ${hex}`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    <label className="flex items-center justify-between pt-1 text-xs cursor-pointer">
                      <span>Progress Bar Atas</span>
                      <input
                        type="checkbox"
                        checked={project.globalStyle.showProgressBar}
                        onChange={(e) =>
                          commitProjectChange((prev) => ({
                            ...prev,
                            globalStyle: {
                              ...prev.globalStyle,
                              showProgressBar: e.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>

                  {/* Motion, Transition & Overlay */}
                  <div className="space-y-3 border-t pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold">Motion</label>
                        <select
                          value={activeScene.motion.preset}
                          onChange={(e) => updateActiveSceneMotion(e.target.value as MotionPreset)}
                          className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
                        >
                          {MOTION_PRESETS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold">Transisi</label>
                        <select
                          value={activeScene.transitionIn.preset}
                          onChange={(e) =>
                            updateActiveSceneTransition(e.target.value as TransitionPreset)
                          }
                          className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
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
                      <label className="mb-1 block text-xs font-semibold">Visual Overlay</label>
                      <select
                        value={activeScene.overlays[0]?.type ?? "none"}
                        onChange={(e) =>
                          setActiveSceneOverlay(e.target.value as "none" | SceneOverlay["type"])
                        }
                        className="ui-input w-full rounded-md px-2.5 py-2 text-xs"
                      >
                        {OVERLAY_PRESETS.map((ov) => (
                          <option key={ov.id} value={ov.id}>
                            {ov.label}
                          </option>
                        ))}
                      </select>

                      {activeScene.overlays[0] && (
                        <div className="mt-2 space-y-2">
                          {activeScene.overlays[0].type === "notification_banner" && (
                            <input
                              type="text"
                              value={activeScene.overlays[0].title ?? ""}
                              onChange={(e) =>
                                updateActiveSceneOverlayField("title", e.target.value)
                              }
                              placeholder="Judul notifikasi"
                              className="ui-input w-full rounded px-2.5 py-1.5 text-xs"
                            />
                          )}
                          <input
                            type="text"
                            value={activeScene.overlays[0].text}
                            onChange={(e) => updateActiveSceneOverlayField("text", e.target.value)}
                            placeholder="Teks overlay"
                            className="ui-input w-full rounded px-2.5 py-1.5 text-xs"
                          />
                          {activeScene.overlays[0].type === "split_screen" && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={!isTauriRuntime()}
                                onClick={handlePickSecondaryFootage}
                                className="ui-btn-secondary flex-1 rounded-md py-1.5 text-xs font-semibold disabled:opacity-45 cursor-pointer"
                              >
                                {activeScene.media.secondaryPath
                                  ? "Ganti B-Roll Bawah"
                                  : "Pilih B-Roll Bawah"}
                              </button>
                              {activeScene.media.secondaryPath && (
                                <button
                                  type="button"
                                  onClick={clearSecondaryFootage}
                                  className="text-xs underline cursor-pointer"
                                  style={{ color: "var(--text-secondary)" }}
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* MANUAL TAB 3: SUARA (VOICEOVER, BGM, SFX) */}
              {manualTab === "audio" && activeScene && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold">Voiceover</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleQuickGenerateTts(false)}
                        disabled={!isTauriRuntime() || isGeneratingTts}
                        className="ui-btn-primary inline-flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold disabled:opacity-45 cursor-pointer"
                      >
                        {isGeneratingTts ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                        Generate TTS
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePickAudio(false)}
                        disabled={!isTauriRuntime()}
                        className="ui-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold disabled:opacity-45 cursor-pointer"
                      >
                        <Music className="h-3.5 w-3.5" />
                        File Lokal
                      </button>
                    </div>
                    {audioPath && (
                      <p className="truncate font-mono-num text-xs" style={{ color: "var(--text-secondary)" }}>
                        {audioPath.split(/[\\/]/).pop()}
                      </p>
                    )}
                  </div>

                  {/* BGM */}
                  <div className="space-y-2.5 border-t pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                    <label className="block text-xs font-semibold">Backsound (BGM)</label>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={project.globalStyle.bgm.preset || "none"}
                        onChange={(e) =>
                          commitProjectChange((prev) => ({
                            ...prev,
                            globalStyle: {
                              ...prev.globalStyle,
                              bgm: { ...prev.globalStyle.bgm, preset: e.target.value },
                            },
                          }))
                        }
                        className="ui-input min-w-0 flex-1 rounded-md px-2.5 py-2 text-xs font-medium"
                      >
                        <option value="none">Tanpa BGM</option>
                        {(audioCatalog.bgm.length > 0 ? audioCatalog.bgm : BGM_PRESETS).map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={
                          !project.globalStyle.bgm.preset ||
                          project.globalStyle.bgm.preset === "none" ||
                          !isTauriRuntime()
                        }
                        onClick={handleToggleAuditionBgm}
                        className="ui-btn-secondary flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md disabled:opacity-40 cursor-pointer"
                        aria-label={isAuditioningBgm ? "Stop BGM" : "Tes BGM"}
                      >
                        {isAuditioningBgm ? (
                          <Square className="h-3 w-3 fill-current" style={{ color: "var(--accent)" }} />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>

                    {project.globalStyle.bgm.preset && project.globalStyle.bgm.preset !== "none" && (
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span style={{ color: "var(--text-secondary)" }}>Volume BGM</span>
                          <span className="font-mono-num" style={{ color: "var(--text-muted)" }}>
                            {Math.round((project.globalStyle.bgm.volume ?? 0.24) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={60}
                          step={1}
                          value={Math.round((project.globalStyle.bgm.volume ?? 0.24) * 100)}
                          onChange={(e) => {
                            const vol = Number(e.target.value) / 100;
                            if (auditionAudioRef.current) auditionAudioRef.current.volume = vol;
                            commitProjectChange(
                              (prev) => ({
                                ...prev,
                                globalStyle: {
                                  ...prev.globalStyle,
                                  bgm: { ...prev.globalStyle.bgm, volume: vol },
                                },
                              }),
                              false
                            );
                          }}
                          className="w-full accent-[var(--accent)] cursor-pointer"
                        />
                      </div>
                    )}

                    <label className="flex items-center justify-between pt-1 text-xs cursor-pointer">
                      <span>Auto-Ducking BGM (-14 dB)</span>
                      <input
                        type="checkbox"
                        checked={project.globalStyle.bgm.autoDucking}
                        onChange={(e) =>
                          commitProjectChange((prev) => ({
                            ...prev,
                            globalStyle: {
                              ...prev.globalStyle,
                              bgm: { ...prev.globalStyle.bgm, autoDucking: e.target.checked },
                            },
                          }))
                        }
                      />
                    </label>
                  </div>

                  {/* Scene SFX */}
                  <div className="space-y-2 border-t pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                    <label className="block text-xs font-semibold">
                      SFX Scene {activeSceneIndex + 1}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={activeScene.sfx[0]?.preset ?? "none"}
                        onChange={(e) => updateActiveSceneSfx(e.target.value)}
                        className="ui-input min-w-0 flex-1 rounded-md px-2.5 py-2 text-xs font-medium"
                      >
                        <option value="none">Tanpa SFX</option>
                        {audioCatalog.sfx.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label} ({item.category})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={
                          !activeScene.sfx[0]?.preset ||
                          activeScene.sfx[0]?.preset === "none" ||
                          !isTauriRuntime()
                        }
                        onClick={() =>
                          activeScene.sfx[0]?.preset && handleAuditionSfx(activeScene.sfx[0].preset)
                        }
                        className="ui-btn-secondary flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md disabled:opacity-40 cursor-pointer"
                        aria-label="Tes SFX"
                      >
                        <Play
                          className="h-3.5 w-3.5"
                          style={{
                            color:
                              auditioningSfxId && auditioningSfxId === activeScene.sfx[0]?.preset
                                ? "var(--accent)"
                                : "currentColor",
                          }}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </main>

      {/* EXPORT MP4 MODAL */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.62)" }}
          onClick={() => !isExporting && setShowExportModal(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl shadow-2xl"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-strong)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-3.5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div>
                <h2 className="text-sm font-bold">Export Video Lokal (MP4)</h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Unlimited, tanpa watermark, diproses langsung di perangkat lo.
                </p>
              </div>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => setShowExportModal(false)}
                className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded disabled:opacity-40 cursor-pointer"
                aria-label="Tutup modal export"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Resolusi
                  </label>
                  <select
                    disabled={isExporting}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as "1080p" | "720p")}
                    className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                  >
                    <option value="1080p">1080×1920 (Full HD)</option>
                    <option value="720p">720×1280 (Draft Cepat)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Frame Rate
                  </label>
                  <select
                    disabled={isExporting}
                    value={exportFps}
                    onChange={(e) => setExportFps(Number(e.target.value) as 30 | 60)}
                    className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                  >
                    <option value={30}>30 FPS</option>
                    <option value={60}>60 FPS</option>
                  </select>
                </div>
              </div>

              <div
                className="grid grid-cols-3 gap-2 rounded-lg p-3 text-xs"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div>
                  <div style={{ color: "var(--text-muted)" }}>Durasi</div>
                  <div className="mt-0.5 font-mono-num font-semibold">
                    {formatTimecode(totalDurationMs)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)" }}>Estimasi</div>
                  <div className="mt-0.5 font-mono-num font-semibold">
                    ~{formatBytes(estimateExportSizeBytes(totalDurationMs, resolution, exportFps))}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)" }}>Engine</div>
                  <div className="mt-0.5 font-mono-num font-semibold">
                    {webCodecs.avcSupported ? "H.264" : "Canvas"} ·{" "}
                    {sidecarStatus?.ffmpegReady ? "FFmpeg" : "Web"}
                  </div>
                </div>
              </div>

              {!audioPath && (
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Sertakan audio demo (tes muxing FFmpeg)</span>
                  <input
                    type="checkbox"
                    disabled={isExporting}
                    checked={generateDemoAudio}
                    onChange={(e) => setGenerateDemoAudio(e.target.checked)}
                  />
                </label>
              )}

              {(isExporting || exportMessage) && (
                <div
                  className="rounded-lg p-3.5 space-y-2.5"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="grid grid-cols-3 gap-1.5 text-xs">
                    {[
                      { id: "init", label: "1. Siapkan" },
                      { id: "encoding", label: "2. Encode" },
                      { id: "muxing", label: "3. Mix Audio" },
                    ].map((st) => {
                      const order = { idle: 0, init: 1, encoding: 2, muxing: 3, done: 4 };
                      const curOrder = order[exportStage];
                      const stOrder = order[st.id as "init" | "encoding" | "muxing"];
                      const active = curOrder === stOrder;
                      const done = curOrder > stOrder;
                      return (
                        <div
                          key={st.id}
                          className="rounded px-2 py-1 text-center font-medium"
                          style={{
                            backgroundColor: active ? "var(--accent-soft)" : "var(--bg-panel)",
                            color: done
                              ? "var(--success)"
                              : active
                                ? "var(--accent)"
                                : "var(--text-muted)",
                          }}
                        >
                          {st.label}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">Progress Render</span>
                    <span className="font-mono-num font-semibold">{Math.round(exportPct)}%</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: "var(--bg-panel)" }}
                  >
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.max(0, exportPct))}%`,
                        backgroundColor: "var(--accent)",
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate" style={{ color: "var(--text-secondary)" }}>
                      {exportMessage}
                    </span>
                    {isExporting && (
                      <span className="shrink-0 font-mono-num" style={{ color: "var(--text-muted)" }}>
                        Sisa ~{formatEta(exportEtaMs)}
                      </span>
                    )}
                    {!isExporting && exportElapsedMs > 0 && exportStage === "done" && (
                      <span className="shrink-0 font-mono-num" style={{ color: "var(--success)" }}>
                        Selesai {formatEta(exportElapsedMs)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {exportError && (
                <div
                  className="rounded-lg p-3 text-xs"
                  style={{
                    backgroundColor: "var(--danger-soft)",
                    border: "1px solid var(--danger)",
                    color: "var(--danger)",
                  }}
                >
                  {exportError}
                </div>
              )}

              {exportResult && (
                <div
                  className="rounded-lg p-3 text-xs"
                  style={{
                    backgroundColor: "var(--success-soft)",
                    border: "1px solid var(--success)",
                  }}
                >
                  <div
                    className="flex items-center gap-1.5 font-semibold"
                    style={{ color: "var(--success)" }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Export MP4 Selesai
                  </div>
                  <p
                    className="mt-1 break-all font-mono-num text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {exportResult.outputPath}
                  </p>
                  <div
                    className="mt-1 flex items-center justify-between font-mono-num text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <span>{formatBytes(exportResult.fileSizeBytes)}</span>
                    <span>{formatTimecode(exportResult.durationMs)}</span>
                  </div>
                  {isTauriRuntime() && (
                    <button
                      type="button"
                      onClick={() => revealInExplorer(exportResult.outputPath)}
                      className="ui-btn-secondary mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Buka di Folder
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                {isExporting ? (
                  <button
                    type="button"
                    onClick={handleCancelExport}
                    className="ui-btn-secondary h-9 rounded-md px-3.5 text-xs font-semibold cursor-pointer"
                    style={{ color: "var(--danger)" }}
                  >
                    Batalkan
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowExportModal(false)}
                    className="ui-btn-secondary h-9 rounded-md px-3.5 text-xs font-medium cursor-pointer"
                  >
                    Tutup
                  </button>
                )}
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={handleExport}
                  className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isExporting ? `Rendering ${Math.round(exportPct)}%` : "Mulai Export MP4"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POWER-USER JSON INSPECTOR MODAL (Ctrl+Shift+J) */}
      {showJsonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
          onClick={() => setShowJsonModal(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl shadow-2xl"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-strong)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <span className="font-mono-num text-xs font-semibold">project.synk.json</span>
              <button
                type="button"
                onClick={() => setShowJsonModal(false)}
                className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre
              className="min-h-0 flex-1 overflow-auto p-4 font-mono-num text-xs leading-relaxed"
              style={{
                backgroundColor: "var(--bg-canvas-well)",
                color: "var(--text-secondary)",
              }}
            >
              {JSON.stringify(project, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
