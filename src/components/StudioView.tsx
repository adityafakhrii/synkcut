import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  Code2,
  Cpu,
  Download,
  Film,
  FolderOpen,
  Layers,
  Loader2,
  Lock,
  Moon,
  Music,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Type,
  Undo2,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import type {
  ByokStatus,
  CaptionPreset,
  MotionPreset,
  SceneOverlay,
  SynkcutProject,
  TransitionPreset,
} from "../types/scene";
import { getProjectDurationMs, rebuildWordsFromScenes } from "../engine/sampleProject";
import { renderProjectFrame } from "../engine/canvasRenderer";
import { checkWebCodecsSupport, exportProjectToMp4 } from "../engine/exportEngine";
import {
  aiCopilotPatch,
  checkSidecars,
  ensureAudioPackAsset,
  extractThumbnails,
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

interface StudioViewProps {
  initialProject: SynkcutProject;
  byokStatus: ByokStatus;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onBackHome: () => void;
  onProjectSaved: () => void;
}

type LeftToolTab = "scenes" | "footage" | "caption" | "motion" | "audio";
type RightPanelTab = "director" | "ai_footage";

interface DirectorLogItem {
  id: string;
  role: "user" | "assistant";
  text: string;
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

// Deterministic pseudo-waveform bars for visual Voiceover Auto-Sync row
const WAVEFORM_BARS = Array.from({ length: 64 }, (_, i) => {
  const wave = Math.abs(Math.sin(i * 0.55) * 0.65 + Math.cos(i * 1.35) * 0.35);
  return Math.max(18, Math.round(wave * 100));
});

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

export default function StudioView({
  initialProject,
  byokStatus,
  theme,
  onToggleTheme,
  onBackHome,
  onProjectSaved,
}: StudioViewProps) {
  const [project, setProject] = useState<SynkcutProject>(initialProject);
  const [pastHistory, setPastHistory] = useState<SynkcutProject[]>([]);
  const [futureHistory, setFutureHistory] = useState<SynkcutProject[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");

  // Studio UI navigation
  const [leftTab, setLeftTab] = useState<LeftToolTab>("scenes");
  const [rightTab, setRightTab] = useState<RightPanelTab>("director");
  const [selectedSceneId, setSelectedSceneId] = useState<string>(
    initialProject.scenes[0]?.id || ""
  );
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Playback state
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // AI Director interactive feed
  const [promptInput, setPromptInput] = useState("");
  const [isPatchingAi, setIsPatchingAi] = useState(false);
  const [directorLog, setDirectorLog] = useState<DirectorLogItem[]>([]);

  // Diagnostics
  const [webCodecs, setWebCodecs] = useState({ supported: false, avcSupported: false });
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);

  // Local media state
  const [footagePath, setFootagePath] = useState<string | null>(
    initialProject.scenes.find((s) => s.media.path)?.media.path ?? null
  );
  const [footageProbe, setFootageProbe] = useState<MediaProbeInfo | null>(null);
  const [footageThumbs, setFootageThumbs] = useState<string[]>([]);
  const [audioPath, setAudioPath] = useState<string | null>(initialProject.voiceover.audioPath);
  const [generateDemoAudio, setGenerateDemoAudio] = useState(!initialProject.voiceover.audioPath);

  // Audio Pack (12 SFX & 6 BGM)
  const [audioCatalog, setAudioCatalog] = useState<AudioPackCatalog>({ sfx: [], bgm: [] });
  const [bgmAssetUrl, setBgmAssetUrl] = useState<string | null>(null);
  const [isAuditioningBgm, setIsAuditioningBgm] = useState(false);
  const [auditioningSfxId, setAuditioningSfxId] = useState<string | null>(null);

  // Export state
  const [resolution, setResolution] = useState<"1080p" | "720p">("1080p");
  const [exportFps, setExportFps] = useState<30 | 60>(30);
  const [isExporting, setIsExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);
  const sfxCacheRef = useRef<Record<string, string>>({});
  const lastTriggeredSceneIdRef = useRef<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTsRef = useRef<number>(0);
  const isFirstRenderRef = useRef(true);
  const isScrubbingRef = useRef(false);

  const totalDurationMs = useMemo(() => Math.max(1000, getProjectDurationMs(project)), [project]);

  const activeScene = useMemo(() => {
    const byId = project.scenes.find((s) => s.id === selectedSceneId);
    return byId ?? project.scenes[0] ?? null;
  }, [project.scenes, selectedSceneId]);

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

  // Keep live BGM volume synchronized (including live Auto-Ducking under Voiceover)
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

  // Render preview frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const videoEl = videoRef.current;
    if (videoEl && activeMediaPath && !isPlaying && videoEl.readyState >= 2 && videoEl.duration > 0) {
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

  // Playback loop + real synced <audio> voiceover + BGM playback
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

    if (videoRef.current && activeMediaPath) {
      videoRef.current.play().catch(() => {});
    }
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

  // Trigger timed scene SFX live during preview playback
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

  // Timeline scrub pointer handlers
  function updateTimeFromClientX(clientX: number) {
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextMs = Math.round(ratio * totalDurationMs);
    setCurrentTimeMs(nextMs);
    const matching = project.scenes.find((s) => nextMs >= s.startMs && nextMs < s.endMs);
    if (matching) setSelectedSceneId(matching.id);
  }

  function handleTimelinePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    setIsPlaying(false);
    isScrubbingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateTimeFromClientX(e.clientX);
  }

  function handleTimelinePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isScrubbingRef.current) return;
    updateTimeFromClientX(e.clientX);
  }

  function handleTimelinePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    isScrubbingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  async function handlePickFootage() {
    if (isTauriRuntime()) {
      const picked = await pickLocalVideo();
      if (!picked) return;
      setFootagePath(picked);
      commitProjectChange((prev) => ({
        ...prev,
        scenes: prev.scenes.map((s) => ({
          ...s,
          media: { ...s.media, path: picked },
        })),
      }));
      try {
        const info = await probeMedia(picked);
        setFootageProbe(info);
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
        setFootagePath(url);
      };
      input.click();
    }
  }

  async function handlePickAudio() {
    const picked = await pickLocalAudio();
    if (!picked) return;
    setAudioPath(picked);
    setGenerateDemoAudio(false);
    commitProjectChange((prev) => ({
      ...prev,
      voiceover: { ...prev.voiceover, source: "recorded", audioPath: picked },
    }));
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
      !preset || preset === "none"
        ? []
        : [{ preset, offsetMs: 0, volume: volume ?? curVol }];
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

  function pushDirectorMessage(role: "user" | "assistant", text: string) {
    setDirectorLog((prev) => [...prev.slice(-8), { id: `${Date.now()}_${Math.random()}`, role, text }]);
  }

  function applyDirectorPreset(presetKey: "hook_punch" | "clean_edu" | "kinetic_fast") {
    if (presetKey === "hook_punch") {
      commitProjectChange((prev) => ({
        ...prev,
        globalStyle: { ...prev.globalStyle, captionPreset: "bold_pop", accentColor: "#38E59D" },
        scenes: prev.scenes.map((s, idx) =>
          idx === 0
            ? {
                ...s,
                motion: { preset: "zoom_punch", intensity: 0.9 },
                overlays: [
                  {
                    id: "ov_hook_dir",
                    type: "notification_banner",
                    title: "Notifikasi · Baru saja",
                    text: "Hook 3 detik pertama langsung diperkuat",
                    position: "top",
                  },
                ],
              }
            : s
        ),
      }));
      setCurrentTimeMs(1000);
      pushDirectorMessage(
        "assistant",
        "Diterapkan: Hook diperkuat dengan Zoom Punch + Bold Pop + Native Notification Banner (0 token)."
      );
    } else if (presetKey === "clean_edu") {
      commitProjectChange((prev) => ({
        ...prev,
        globalStyle: { ...prev.globalStyle, captionPreset: "clean_minimal", accentColor: "#38BDF8" },
        scenes: prev.scenes.map((s) => ({
          ...s,
          motion: { preset: "smooth_ken_burns", intensity: 0.65 },
        })),
      }));
      pushDirectorMessage(
        "assistant",
        "Diterapkan: Gaya Clean Minimal + Smooth Ken Burns dengan aksen Cyan (0 token)."
      );
    } else {
      commitProjectChange((prev) => ({
        ...prev,
        globalStyle: { ...prev.globalStyle, captionPreset: "kinetic_punch", accentColor: "#38E59D" },
        scenes: prev.scenes.map((s) => ({
          ...s,
          motion: { preset: "shake_impact", intensity: 0.8 },
        })),
      }));
      pushDirectorMessage(
        "assistant",
        "Diterapkan: Mode energik Kinetic Punch 2 kata + Shake Impact (0 token)."
      );
    }
  }

  async function handleDirectorPromptSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = promptInput.trim();
    if (!raw || isPatchingAi) return;
    setPromptInput("");
    pushDirectorMessage("user", raw);

    // When running in Tauri desktop with BYOK configured, invoke real LLM JSON Patching!
    if (isTauriRuntime() && activeByokOk) {
      setIsPatchingAi(true);
      try {
        const res = await aiCopilotPatch(project, raw);
        commitProjectChange(() => ({
          ...res.project,
          voiceover: {
            ...res.project.voiceover,
            words: rebuildWordsFromScenes(res.project),
          },
        }));
        pushDirectorMessage("assistant", `${res.reply} (${res.providerUsed})`);
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

    // Zero-token offline/local instant command fallback
    const lower = raw.toLowerCase();
    if (lower.includes("editorial") || lower.includes("luxury") || lower.includes("serif")) {
      commitProjectChange((prev) => ({
        ...prev,
        globalStyle: { ...prev.globalStyle, captionPreset: "luxury_editorial", accentColor: "#F59E0B" },
      }));
      pushDirectorMessage("assistant", "Style caption diubah ke Luxury Editorial (serif + aksen amber).");
    } else if (lower.includes("neon")) {
      commitProjectChange((prev) => ({
        ...prev,
        globalStyle: { ...prev.globalStyle, captionPreset: "neon_tech", accentColor: "#38E59D" },
      }));
      pushDirectorMessage("assistant", "Style caption diubah ke Neon Tech dengan aksen Emerald-Mint.");
    } else if (lower.includes("minimal") || lower.includes("clean")) {
      applyDirectorPreset("clean_edu");
    } else if (lower.includes("notif")) {
      setActiveSceneOverlay("notification_banner");
      pushDirectorMessage("assistant", "Native Notification Banner ditambahkan pada scene aktif.");
    } else if (lower.includes("headline") || lower.includes("judul")) {
      setActiveSceneOverlay("hook_headline");
      pushDirectorMessage("assistant", "Hook Headline Card ditambahkan pada scene aktif.");
    } else if (lower.includes("doodle") || lower.includes("coret") || lower.includes("spidol")) {
      setActiveSceneOverlay("doodle_highlight");
      pushDirectorMessage("assistant", "Doodle Marker Highlight ditambahkan pada scene aktif.");
    } else if (lower.includes("split") || lower.includes("b-roll") || lower.includes("broll")) {
      setActiveSceneOverlay("split_screen");
      pushDirectorMessage("assistant", "Split-Screen / B-Roll diaktifkan pada scene aktif.");
    } else if (lower.includes("badge") || lower.includes("promo")) {
      setActiveSceneOverlay("promo_badge");
      pushDirectorMessage("assistant", "Promo Badge ditambahkan pada scene aktif.");
    } else {
      pushDirectorMessage(
        "assistant",
        "Atur API Key BYOK di Pengaturan AI agar AI Director dapat mengeksekusi revisi bebas lewat JSON Patch."
      );
    }
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

    setIsPlaying(false);
    setIsExporting(true);
    setExportPct(0);
    setExportMessage("Memulai pipeline export...");

    try {
      const result = await exportProjectToMp4(project, {
        resolution,
        fps: exportFps,
        audioPath,
        generateDemoAudio,
        outputPath: savePath,
        videoElement: footagePath ? videoRef.current : null,
        onProgress: (pct, _stage, msg) => {
          setExportPct(pct);
          setExportMessage(msg);
        },
      });
      setExportResult(result);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  }

  const roleColor = (role: "hook" | "body" | "cta") => {
    if (role === "hook") return "var(--role-hook)";
    if (role === "body") return "var(--role-body)";
    return "var(--role-cta)";
  };

  const playheadPercent = Math.max(0, Math.min(100, (currentTimeMs / totalDurationMs) * 100));
  const activeByokOk = byokStatus.providers[byokStatus.activeProvider]?.configured;
  const providerLabel =
    byokStatus.activeProvider === "gemini"
      ? "Gemini"
      : byokStatus.activeProvider === "openai"
        ? "OpenAI"
        : "OpenRouter";

  const RAIL_ITEMS: Array<{ id: LeftToolTab; label: string; icon: typeof Layers }> = [
    { id: "scenes", label: "Scenes", icon: Layers },
    { id: "footage", label: "Footage", icon: Film },
    { id: "caption", label: "Caption", icon: Type },
    { id: "motion", label: "Motion", icon: SlidersHorizontal },
    { id: "audio", label: "Audio", icon: Volume2 },
  ];

  const rulerTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    ratio: r,
    label: formatTimecode(totalDurationMs * r).slice(0, 5),
  }));

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
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

      {/* Top Studio Bar */}
      <header
        className="flex h-[52px] shrink-0 items-center justify-between border-b px-3.5"
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
            className="hidden shrink-0 items-center gap-1 text-[11px] md:inline-flex"
            style={{ color: "var(--text-muted)" }}
          >
            <Check className="h-3 w-3" style={{ color: "var(--success)" }} />
            {saveState === "saving"
              ? "Menyimpan..."
              : saveState === "dirty"
                ? "Belum tersimpan"
                : "Tersimpan"}
          </span>
        </div>

        {/* Center Undo / Redo */}
        <div className="hidden items-center gap-1 sm:flex">
          <button
            type="button"
            disabled={pastHistory.length === 0}
            onClick={handleUndo}
            className="ui-btn-secondary flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40 cursor-pointer"
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={futureHistory.length === 0}
            onClick={handleRedo}
            className="ui-btn-secondary flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40 cursor-pointer"
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right Controls */}
        <div className="flex shrink-0 items-center gap-2">
          <div
            className="hidden items-center gap-2 rounded-md px-2.5 py-1 text-[11px] xl:flex"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
            title={sidecarStatus?.ffmpegVersion || ""}
          >
            <span className="inline-flex items-center gap-1">
              <Cpu
                className="h-3 w-3"
                style={{ color: webCodecs.avcSupported ? "var(--success)" : "var(--role-hook)" }}
              />
              WebCodecs
            </span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck
                className="h-3 w-3"
                style={{
                  color: sidecarStatus?.ffmpegReady ? "var(--success)" : "var(--text-muted)",
                }}
              />
              {sidecarStatus?.ffmpegReady ? "FFmpeg LGPL" : isTauriRuntime() ? "FFmpeg" : "Web"}
            </span>
          </div>

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

      {/* FLOATING MODULAR BENTO-STUDIO WORKSPACE */}
      <main className="flex min-h-0 flex-1 gap-2.5 overflow-hidden p-2.5">
        {/* 1. Far-Left Slim Icon Rail (60px) */}
        <nav
          className="ui-panel flex w-[60px] shrink-0 flex-col items-center gap-1 rounded-xl py-2.5"
          aria-label="Alat Studio"
        >
          {RAIL_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = leftTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setLeftTab(item.id)}
                className="relative flex w-[48px] flex-col items-center justify-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: active ? "var(--bg-elevated)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  border: active ? "1px solid var(--border-subtle)" : "1px solid transparent",
                }}
              >
                <Icon
                  className="h-4 w-4"
                  style={{ color: active ? "var(--accent)" : "currentColor" }}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 2. Left Contextual Inspector (276px) */}
        <aside className="ui-panel flex w-[276px] shrink-0 flex-col overflow-hidden rounded-xl">
          <div
            className="flex h-11 shrink-0 items-center justify-between border-b px-3.5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <h2 className="text-xs font-bold">
              {leftTab === "scenes" && "Scene Cards"}
              {leftTab === "footage" && "Footage Lokal"}
              {leftTab === "caption" && "Style & Kinetic Caption"}
              {leftTab === "motion" && "Motion, Transisi & Overlay"}
              {leftTab === "audio" && "Suara & Backsound"}
            </h2>
            {leftTab === "scenes" && (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                0 token AI
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-3">
            {/* TAB: SCENES */}
            {leftTab === "scenes" &&
              project.scenes.map((scene, idx) => {
                const isSelected = activeScene?.id === scene.id;
                return (
                  <div
                    key={scene.id}
                    onClick={() => {
                      setSelectedSceneId(scene.id);
                      setCurrentTimeMs(scene.startMs);
                    }}
                    className="rounded-lg p-3 transition-colors cursor-pointer"
                    style={{
                      backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-elevated)",
                      border: isSelected
                        ? "1px solid var(--border-strong)"
                        : "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: roleColor(scene.role) }}
                        />
                        {idx + 1}. {scene.role}
                      </span>
                      <span
                        className="font-mono-num text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {formatTimecode(scene.startMs)}–{formatTimecode(scene.endMs)}
                      </span>
                    </div>

                    <textarea
                      value={scene.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleSceneTextChange(scene.id, e.target.value)}
                      rows={3}
                      className="ui-input w-full resize-none rounded-md p-2 text-xs leading-relaxed"
                    />
                  </div>
                );
              })}

            {/* TAB: FOOTAGE */}
            {leftTab === "footage" && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handlePickFootage}
                  className="ui-btn-primary flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold cursor-pointer"
                >
                  <Upload className="h-4 w-4" />
                  {footagePath ? "Ganti Footage MP4 Lokal" : "Import Footage MP4 Lokal"}
                </button>

                <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Footage diproses langsung dari penyimpanan lokal tanpa upload ke cloud. FFmpeg
                  otomatis mengekstrak thumbnail kecil untuk AI Multimodal Director.
                </p>

                {footageProbe ? (
                  <div
                    className="rounded-lg p-3 space-y-2.5"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="flex items-center justify-between font-mono-num text-[11px]">
                      <span className="font-semibold">
                        {footageProbe.width}×{footageProbe.height} · {footageProbe.fps}fps
                      </span>
                      <span style={{ color: "var(--text-secondary)" }}>
                        {formatTimecode(footageProbe.durationMs)}
                      </span>
                    </div>
                    {footageThumbs.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
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
                ) : (
                  <div
                    className="rounded-lg p-4 text-center text-xs"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px dashed var(--border-strong)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Belum ada footage lokal dipilih. Preview saat ini menggunakan backdrop studio.
                  </div>
                )}
              </div>
            )}

            {/* TAB: CAPTION */}
            {leftTab === "caption" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  {CAPTION_PRESETS.map((preset) => {
                    const active = project.globalStyle.captionPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          commitProjectChange((prev) => ({
                            ...prev,
                            globalStyle: { ...prev.globalStyle, captionPreset: preset.id },
                          }))
                        }
                        className="ui-row flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left cursor-pointer"
                        style={{
                          backgroundColor: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                          border: active
                            ? "1px solid var(--accent)"
                            : "1px solid var(--border-subtle)",
                        }}
                      >
                        <div>
                          <div className="text-xs font-semibold">{preset.label}</div>
                          <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {preset.sample}
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

                <div className="border-t pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                  <div className="mb-2 text-xs font-semibold">Warna Sorotan Kata</div>
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

                <label
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 text-xs cursor-pointer"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <span>Progress Bar Atas</span>
                  <input
                    type="checkbox"
                    checked={project.globalStyle.showProgressBar}
                    onChange={(e) =>
                      commitProjectChange((prev) => ({
                        ...prev,
                        globalStyle: { ...prev.globalStyle, showProgressBar: e.target.checked },
                      }))
                    }
                  />
                </label>
              </div>
            )}

            {/* TAB: MOTION & OVERLAY */}
            {leftTab === "motion" && activeScene && (
              <div className="space-y-4">
                <div
                  className="flex items-center justify-between rounded-md px-3 py-2 text-xs"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>Scene Aktif:</span>
                  <span className="font-bold uppercase" style={{ color: roleColor(activeScene.role) }}>
                    {activeScene.role}
                  </span>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Motion Footage</label>
                  <div className="space-y-1.5">
                    {MOTION_PRESETS.map((m) => {
                      const active = activeScene.motion.preset === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => updateActiveSceneMotion(m.id)}
                          className="ui-row flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--accent)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          <span>{m.label}</span>
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
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Transisi Masuk</label>
                  <select
                    value={activeScene.transitionIn.preset}
                    onChange={(e) =>
                      updateActiveSceneTransition(e.target.value as TransitionPreset)
                    }
                    className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                  >
                    {TRANSITION_PRESETS.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Visual Overlay (6 Preset)</label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {OVERLAY_PRESETS.map((ov) => {
                      const curType = activeScene.overlays[0]?.type ?? "none";
                      const active = curType === ov.id;
                      return (
                        <button
                          key={ov.id}
                          type="button"
                          onClick={() => setActiveSceneOverlay(ov.id)}
                          className="ui-row flex items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--accent)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          <span>{ov.label}</span>
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

                  {/* Live inline editor for active overlay */}
                  {activeScene.overlays[0] && (
                    <div
                      className="mt-2.5 space-y-2 rounded-lg p-2.5"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      {activeScene.overlays[0].type === "notification_banner" && (
                        <div>
                          <label
                            className="mb-1 block text-[11px] font-medium"
                            style={{ color: "var(--text-muted)" }}
                          >
                            Judul Notifikasi
                          </label>
                          <input
                            type="text"
                            value={activeScene.overlays[0].title ?? ""}
                            onChange={(e) => updateActiveSceneOverlayField("title", e.target.value)}
                            className="ui-input w-full rounded px-2 py-1.5 text-xs"
                          />
                        </div>
                      )}
                      <div>
                        <label
                          className="mb-1 block text-[11px] font-medium"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {activeScene.overlays[0].type === "split_screen"
                            ? "Label Pembatas Split-Screen"
                            : "Teks Overlay"}
                        </label>
                        <input
                          type="text"
                          value={activeScene.overlays[0].text}
                          onChange={(e) => updateActiveSceneOverlayField("text", e.target.value)}
                          className="ui-input w-full rounded px-2 py-1.5 text-xs"
                        />
                      </div>

                      {activeScene.overlays[0].type === "split_screen" && (
                        <div className="pt-1 space-y-1.5">
                          <button
                            type="button"
                            disabled={!isTauriRuntime()}
                            onClick={handlePickSecondaryFootage}
                            className="ui-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                          >
                            <Film className="h-3.5 w-3.5" />
                            {activeScene.media.secondaryPath
                              ? "Ganti Footage B-Roll (Bawah)"
                              : "Pilih Footage B-Roll (Bawah)"}
                          </button>
                          <div
                            className="flex items-center justify-between gap-2 text-[11px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <span className="truncate font-mono-num">
                              {activeScene.media.secondaryPath
                                ? activeScene.media.secondaryPath.split(/[\\/]/).pop()
                                : "Default: Auto Zoom Detail 1.45×"}
                            </span>
                            {activeScene.media.secondaryPath && (
                              <button
                                type="button"
                                onClick={clearSecondaryFootage}
                                className="shrink-0 underline cursor-pointer"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* SFX Scene Picker (12 SFX) */}
                <div className="border-t pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                  <label className="mb-1.5 block text-xs font-semibold">
                    SFX Transisi / Aksen (12 Preset)
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
                      title="Tes SFX ini"
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

                  {activeScene.sfx[0]?.preset && activeScene.sfx[0].preset !== "none" && (
                    <div className="mt-2.5">
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span style={{ color: "var(--text-secondary)" }}>Volume SFX</span>
                        <span className="font-mono-num" style={{ color: "var(--text-muted)" }}>
                          {Math.round((activeScene.sfx[0].volume ?? 0.65) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={5}
                        value={Math.round((activeScene.sfx[0].volume ?? 0.65) * 100)}
                        onChange={(e) =>
                          updateActiveSceneSfx(
                            activeScene.sfx[0].preset,
                            Number(e.target.value) / 100
                          )
                        }
                        className="w-full accent-[var(--accent)] cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: AUDIO */}
            {leftTab === "audio" && (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold">Voiceover Lokal</div>
                  <button
                    type="button"
                    onClick={handlePickAudio}
                    disabled={!isTauriRuntime()}
                    className="ui-btn-secondary flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    <Music className="h-4 w-4" />
                    {audioPath ? "Ganti File Audio (MP3/WAV)" : "Pilih File Audio / Suara Sendiri"}
                  </button>
                  {audioPath && (
                    <p
                      className="mt-1.5 truncate font-mono-num text-[11px]"
                      style={{ color: "var(--text-secondary)" }}
                      title={audioPath}
                    >
                      {audioPath.split(/[\\/]/).pop()}
                    </p>
                  )}
                </div>

                {!audioPath && (
                  <label
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-xs cursor-pointer"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span>Audio Demo saat Export</span>
                    <input
                      type="checkbox"
                      checked={generateDemoAudio}
                      onChange={(e) => setGenerateDemoAudio(e.target.checked)}
                    />
                  </label>
                )}

                <div className="border-t pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
                  <label className="mb-1.5 block text-xs font-semibold">
                    Mood Backsound (6 BGM Pack)
                  </label>
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
                      title={isAuditioningBgm ? "Stop preview BGM" : "Tes preview BGM"}
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
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px]">
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
                          if (auditionAudioRef.current) {
                            auditionAudioRef.current.volume = vol;
                          }
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

                  <label
                    className="mt-2.5 flex items-center justify-between rounded-lg px-3 py-2.5 text-xs cursor-pointer"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
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

                  <div
                    className="mt-3 rounded-lg p-3 text-[11px] leading-relaxed"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <div className="flex items-center justify-between font-medium">
                      <span>Mix Pipeline FFmpeg</span>
                      <span className="font-mono-num" style={{ color: "var(--accent)" }}>
                        {project.scenes.reduce((acc, s) => acc + s.sfx.length, 0)} SFX aktif
                      </span>
                    </div>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Voiceover, BGM (auto-ducking sidechain), dan SFX per scene otomatis dicampur
                      saat Export MP4. Atur SFX tiap scene di tab Motion.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* 3. Center Column: 9:16 Stage + Simplified 2-Row Visual Scene Strip */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
          {/* 9:16 Preview Stage Card */}
          <div className="ui-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
            {/* Stage Micro Header */}
            <div
              className="flex h-10 shrink-0 items-center justify-between border-b px-3.5 text-xs"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono-num text-[11px] font-semibold">9:16 · 1080×1920</span>
                {activeScene && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: roleColor(activeScene.role) }}
                    />
                    {activeScene.role}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <label
                  className="flex items-center gap-1.5 text-[11px] cursor-pointer"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <input
                    type="checkbox"
                    checked={showSafeZone}
                    onChange={(e) => setShowSafeZone(e.target.checked)}
                  />
                  Safe Zone
                </label>

                <button
                  type="button"
                  onClick={() => setShowJsonModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                  style={{ color: "var(--text-muted)" }}
                  title="Inspeksi project.synk.json"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  JSON
                </button>
              </div>
            </div>

            {/* Recessed Dot-Grid Canvas Stage */}
            <div className="ui-stage-grid flex min-h-0 flex-1 items-center justify-center p-3">
              <canvas
                ref={canvasRef}
                width={1080}
                height={1920}
                className="max-h-full w-auto rounded-xl"
                style={{
                  aspectRatio: "9 / 16",
                  border: "1px solid var(--border-strong)",
                  boxShadow: "0 14px 36px rgba(0, 0, 0, 0.35)",
                  backgroundColor: "#000000",
                }}
              />
            </div>

            {/* Playback Transport Bar */}
            <div
              className="flex h-11 shrink-0 items-center justify-between border-t px-4"
              style={{ borderColor: "var(--border-subtle)" }}
            >
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
                  className="ui-btn-primary flex h-8 w-8 items-center justify-center rounded-full cursor-pointer"
                  aria-label={isPlaying ? "Pause preview" : "Play preview"}
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                </button>
              </div>

              <span
                className="font-mono-num text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {project.meta.fps} FPS
              </span>
            </div>
          </div>

          {/* Simplified 2-Row Visual Scene Strip */}
          <div className="ui-panel flex h-[138px] shrink-0 flex-col overflow-hidden rounded-xl">
            {/* Time Ruler */}
            <div
              className="flex h-6 shrink-0 items-center justify-between border-b px-3 font-mono-num text-[10px]"
              style={{
                borderColor: "var(--border-subtle)",
                backgroundColor: "var(--bg-elevated)",
                color: "var(--text-muted)",
              }}
            >
              <div className="flex flex-1 items-center justify-between pr-2 pl-14">
                {rulerTicks.map((tick, idx) => (
                  <span key={idx}>{tick.label}</span>
                ))}
              </div>
            </div>

            {/* Interactive Scrub Tracks */}
            <div className="flex min-h-0 flex-1">
              {/* Row Labels */}
              <div
                className="flex w-16 shrink-0 flex-col justify-center gap-2 border-r px-2.5 text-[10px] font-semibold"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-muted)",
                }}
              >
                <div className="flex h-10 items-center">Scene</div>
                <div className="flex h-8 items-center">Audio</div>
              </div>

              {/* Track Lanes + Draggable Playhead */}
              <div className="flex min-w-0 flex-1 overflow-hidden px-2.5 py-2">
                <div
                  ref={timelineRef}
                  onPointerDown={handleTimelinePointerDown}
                  onPointerMove={handleTimelinePointerMove}
                  onPointerUp={handleTimelinePointerUp}
                  className="relative flex min-w-0 flex-1 flex-col justify-center gap-2 select-none cursor-ew-resize"
                >
                  {/* Row 1: Scene Blocks */}
                  <div className="relative flex h-10 w-full gap-1.5">
                    {project.scenes.map((scene, idx) => {
                      const widthPct = ((scene.endMs - scene.startMs) / totalDurationMs) * 100;
                      const isSelected = activeScene?.id === scene.id;
                      return (
                        <div
                          key={scene.id}
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-elevated)",
                            border: isSelected
                              ? "1px solid var(--border-strong)"
                              : "1px solid var(--border-subtle)",
                          }}
                          className="flex h-full min-w-0 flex-col justify-center overflow-hidden rounded-md px-2.5"
                        >
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: roleColor(scene.role) }}
                            />
                            <span style={{ color: "var(--text-primary)" }}>
                              {idx + 1}. {scene.role}
                            </span>
                          </div>
                          <div
                            className="truncate text-[10px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {scene.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Row 2: Voiceover Auto-Sync Waveform Bar */}
                  <div
                    className="flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-md px-2.5"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span
                      className="shrink-0 text-[10px] font-medium"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {audioPath
                        ? audioPath.split(/[\\/]/).pop()
                        : "Voiceover · Auto-Sync"}
                    </span>
                    <div className="flex h-full min-w-0 flex-1 items-center justify-between gap-[2px]">
                      {WAVEFORM_BARS.slice(0, 44).map((h, i) => (
                        <span
                          key={i}
                          className="w-[2px] rounded-full"
                          style={{
                            height: `${Math.max(18, h * 0.54)}%`,
                            backgroundColor: "var(--waveform)",
                          }}
                        />
                      ))}
                    </div>
                    <span
                      className="shrink-0 font-mono-num text-[10px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {!project.globalStyle.bgm.preset || project.globalStyle.bgm.preset === "none"
                        ? "Tanpa BGM"
                        : `${
                            (audioCatalog.bgm.length > 0 ? audioCatalog.bgm : BGM_PRESETS).find(
                              (b) => b.id === project.globalStyle.bgm.preset
                            )?.label ?? "BGM"
                          }${project.globalStyle.bgm.autoDucking ? " · Ducking" : ""}`}
                    </span>
                  </div>

                  {/* Vertical Playhead aligned pixel-perfect to track bounds */}
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-20 w-[1.5px]"
                    style={{
                      left: `${playheadPercent}%`,
                      backgroundColor: "var(--playhead)",
                    }}
                  >
                    <div
                      className="h-2 w-2 -translate-x-[3.25px] rounded-full"
                      style={{ backgroundColor: "var(--accent)" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Right Panel: AI Video Director + AI Footage (Coming Soon) */}
        <aside className="ui-panel flex w-[310px] shrink-0 flex-col overflow-hidden rounded-xl">
          {/* Top Segmented Tabs (Inspired by CutCut) */}
          <div
            className="grid h-11 shrink-0 grid-cols-2 border-b p-1.5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <button
              type="button"
              onClick={() => setRightTab("director")}
              className="inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer"
              style={{
                backgroundColor: rightTab === "director" ? "var(--bg-elevated)" : "transparent",
                color: rightTab === "director" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
              AI Director
            </button>
            <button
              type="button"
              onClick={() => setRightTab("ai_footage")}
              className="inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer"
              style={{
                backgroundColor: rightTab === "ai_footage" ? "var(--bg-elevated)" : "transparent",
                color: rightTab === "ai_footage" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <Wand2 className="h-3.5 w-3.5" />
              AI Footage
            </button>
          </div>

          {rightTab === "director" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Director Status Strip */}
              <div
                className="flex items-center justify-between border-b px-3.5 py-2 text-[11px]"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: activeByokOk ? "var(--success)" : "var(--role-hook)" }}
                  />
                  {activeByokOk ? `BYOK · ${providerLabel}` : "BYOK Offline"}
                </span>
                <span className="font-mono-num" style={{ color: "var(--text-muted)" }}>
                  0 Credit Burn
                </span>
              </div>

              {/* Scrollable Suggestions + Activity Feed */}
              <div className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-3">
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Klik saran di bawah untuk menerapkan gaya & pacing secara instan tanpa membakar
                  token AI, atau ketik arahan revisi.
                </p>

                {/* 1-Click Apply Suggestion Cards (Inspired by Reelio) */}
                <div className="space-y-2">
                  {[
                    {
                      key: "hook_punch" as const,
                      title: "Perkuat Hook 3 Detik Pertama",
                      desc: "Zoom Punch + Bold Pop + Notifikasi Pop-up",
                      time: "00:00–00:03",
                    },
                    {
                      key: "clean_edu" as const,
                      title: "Gaya Edukasi Bersih",
                      desc: "Clean Minimal + Smooth Ken Burns + Cyan",
                      time: "Semua scene",
                    },
                    {
                      key: "kinetic_fast" as const,
                      title: "Pacing Cepat & Nendang",
                      desc: "Kinetic Punch 2 kata + Shake Impact",
                      time: "Semua scene",
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="rounded-lg p-3"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div className="text-xs font-bold">{item.title}</div>
                      <div
                        className="mt-0.5 text-[11px] leading-snug"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {item.desc}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between">
                        <span
                          className="font-mono-num text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {item.time}
                        </span>
                        <button
                          type="button"
                          onClick={() => applyDirectorPreset(item.key)}
                          className="ui-btn-secondary rounded-md px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Activity Log */}
                {directorLog.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {directorLog.map((msg) => (
                      <div
                        key={msg.id}
                        className="rounded-lg px-3 py-2 text-xs leading-relaxed"
                        style={{
                          backgroundColor:
                            msg.role === "user" ? "var(--accent-soft)" : "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-primary)",
                        }}
                      >
                        {msg.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Quick Chips + Prompt Composer */}
              <div
                className="border-t p-3 space-y-2.5"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="flex flex-wrap gap-1.5">
                  {[
                    {
                      label: "+ Notif Pop-up",
                      action: () => {
                        setActiveSceneOverlay("notification_banner");
                        pushDirectorMessage("assistant", "Notifikasi pop-up aktif di scene terpilih.");
                      },
                    },
                    {
                      label: "+ Badge Promo",
                      action: () => {
                        setActiveSceneOverlay("promo_badge");
                        pushDirectorMessage("assistant", "Badge promo aktif di scene terpilih.");
                      },
                    },
                    {
                      label: "Toggle Safe Zone",
                      action: () => setShowSafeZone((v) => !v),
                    },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={chip.action}
                      className="ui-btn-secondary rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <form
                  onSubmit={handleDirectorPromptSubmit}
                  className="flex items-end gap-2 rounded-lg p-2"
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
                    placeholder="Ketik arahan... mis. ubah style ke editorial atau tambah notif"
                    className="min-w-0 flex-1 resize-none bg-transparent text-xs leading-relaxed outline-none"
                    style={{ color: "var(--text-primary)" }}
                  />
                  <button
                    type="submit"
                    disabled={!promptInput.trim() || isPatchingAi}
                    className="ui-btn-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-md disabled:opacity-40 cursor-pointer"
                    aria-label="Kirim arahan"
                  >
                    {isPatchingAi ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowUp className="h-3.5 w-3.5" />
                    )}
                  </button>
                </form>
              </div>
            </div>
          ) : (
            /* TAB 2: AI FOOTAGE (GOOGLE FLOW / SEEDANCE — COMING SOON) */
            <div className="flex flex-1 flex-col justify-between p-4">
              <div className="space-y-4 opacity-70">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Text-to-Video Footage</span>
                  <span
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      backgroundColor: "var(--accent-soft)",
                      color: "var(--accent)",
                    }}
                  >
                    <Lock className="h-3 w-3" />
                    Coming Soon
                  </span>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Deskripsi Klip
                  </label>
                  <textarea
                    disabled
                    rows={4}
                    value="Close-up sinematik kopi susu dituang perlahan ke gelas es dengan pencahayaan studio hangat..."
                    className="ui-input w-full resize-none rounded-md p-2.5 text-xs"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Provider Video AI
                  </label>
                  <select disabled className="ui-input w-full rounded-md px-2.5 py-2 text-xs">
                    <option>Google Flow / Veo</option>
                    <option>Seedance</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Rasio
                    </label>
                    <input
                      disabled
                      value="9:16 Vertikal"
                      className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Durasi
                    </label>
                    <input
                      disabled
                      value="5 detik"
                      className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div
                className="rounded-lg p-3 text-xs leading-relaxed"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px dashed var(--border-strong)",
                  color: "var(--text-secondary)",
                }}
              >
                Rilis v1 fokus pada <strong>footage lokal 100% gratis render</strong>. Integrasi
                Google Flow & Seedance disiapkan pada Phase 3.
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* EXPORT MP4 MODAL (Layar 5 PRD) */}
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

              {!audioPath && (
                <label
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 text-xs cursor-pointer"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
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
                  className="rounded-lg p-3"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold">Progress Render</span>
                    <span className="font-mono-num">{Math.round(exportPct)}%</span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full"
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
                  <p className="mt-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {exportMessage}
                  </p>
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
                    className="mt-1 break-all font-mono-num text-[11px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {exportResult.outputPath}
                  </p>
                  <div
                    className="mt-1 flex items-center justify-between font-mono-num text-[11px]"
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

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => setShowExportModal(false)}
                  className="ui-btn-secondary h-9 rounded-md px-3.5 text-xs font-medium disabled:opacity-40 cursor-pointer"
                >
                  Tutup
                </button>
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

      {/* JSON INSPECTOR MODAL */}
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
              className="min-h-0 flex-1 overflow-auto p-4 font-mono-num text-[11px] leading-relaxed"
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
