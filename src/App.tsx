import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Download,
  Film,
  FolderOpen,
  Layers,
  Lock,
  Moon,
  Music,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import type { CaptionPreset, MotionPreset, SynkcutProject } from "./types/scene";
import {
  createSampleProject,
  getProjectDurationMs,
  rebuildWordsFromScenes,
} from "./engine/sampleProject";
import { renderProjectFrame } from "./engine/canvasRenderer";
import { checkWebCodecsSupport, exportProjectToMp4 } from "./engine/exportEngine";
import {
  checkSidecars,
  extractThumbnails,
  isTauriRuntime,
  listenExportProgress,
  pickExportSavePath,
  pickLocalAudio,
  pickLocalVideo,
  probeMedia,
  revealInExplorer,
  toAssetUrl,
  type ExportResult,
  type MediaProbeInfo,
  type SidecarStatus,
} from "./lib/tauriBridge";

const CAPTION_PRESETS: Array<{ id: CaptionPreset; label: string }> = [
  { id: "bold_pop", label: "Bold Pop" },
  { id: "clean_minimal", label: "Clean Minimal" },
  { id: "kinetic_punch", label: "Kinetic Punch" },
  { id: "luxury_editorial", label: "Luxury Editorial" },
  { id: "neon_tech", label: "Neon Tech" },
];

const MOTION_PRESETS: Array<{ id: MotionPreset; label: string }> = [
  { id: "zoom_punch", label: "Zoom Punch" },
  { id: "smooth_ken_burns", label: "Ken Burns" },
  { id: "shake_impact", label: "Shake Impact" },
  { id: "slide_reveal", label: "Slide Reveal" },
  { id: "static_clean", label: "Static Clean" },
];

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

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [project, setProject] = useState<SynkcutProject>(() => createSampleProject());
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [showJson, setShowJson] = useState(false);

  // Diagnostics
  const [webCodecs, setWebCodecs] = useState({ supported: false, avcSupported: false });
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);

  // Local media state
  const [footagePath, setFootagePath] = useState<string | null>(null);
  const [footageProbe, setFootageProbe] = useState<MediaProbeInfo | null>(null);
  const [footageThumbs, setFootageThumbs] = useState<string[]>([]);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [generateDemoAudio, setGenerateDemoAudio] = useState(true);

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
  const rafRef = useRef<number | null>(null);
  const lastFrameTsRef = useRef<number>(0);

  const totalDurationMs = useMemo(() => getProjectDurationMs(project), [project]);

  // Apply Dark / Light Studio class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Diagnostics on boot
  useEffect(() => {
    checkWebCodecsSupport().then(setWebCodecs);
    checkSidecars().then(setSidecarStatus);

    let unlisten: (() => void) | null = null;
    listenExportProgress((ev) => {
      setExportPct(ev.percent);
      setExportMessage(ev.message);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Render preview whenever state or playhead changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const videoEl = videoRef.current;
    if (videoEl && footagePath && !isPlaying && videoEl.readyState >= 2 && videoEl.duration > 0) {
      const targetSec = (currentTimeMs / 1000) % videoEl.duration;
      if (Math.abs(videoEl.currentTime - targetSec) > 0.04) {
        videoEl.currentTime = targetSec;
      }
    }

    renderProjectFrame(ctx, project, currentTimeMs, {
      videoElement: footagePath ? videoEl : null,
      showSafeZone,
    });
  }, [project, currentTimeMs, showSafeZone, footagePath, isPlaying]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      videoRef.current?.pause();
      return;
    }

    if (videoRef.current && footagePath) {
      videoRef.current.play().catch(() => {});
    }

    lastFrameTsRef.current = performance.now();
    const tick = (now: number) => {
      const delta = now - lastFrameTsRef.current;
      lastFrameTsRef.current = now;
      setCurrentTimeMs((prev) => {
        const next = prev + delta;
        if (next >= totalDurationMs) {
          if (videoRef.current) videoRef.current.currentTime = 0;
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
  }, [isPlaying, totalDurationMs, footagePath]);

  async function handlePickFootage() {
    if (isTauriRuntime()) {
      const picked = await pickLocalVideo();
      if (!picked) return;
      setFootagePath(picked);
      setProject((prev) => ({
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
    setProject((prev) => ({
      ...prev,
      voiceover: { ...prev.voiceover, source: "recorded", audioPath: picked },
    }));
  }

  function handleSceneTextChange(sceneId: string, newText: string) {
    setProject((prev) => {
      const updated: SynkcutProject = {
        ...prev,
        scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, text: newText } : s)),
      };
      return {
        ...updated,
        voiceover: {
          ...updated.voiceover,
          words: rebuildWordsFromScenes(updated),
        },
      };
    });
  }

  function handleSceneMotionChange(sceneId: string, motionPreset: MotionPreset) {
    setProject((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id === sceneId ? { ...s, motion: { ...s.motion, preset: motionPreset } } : s
      ),
    }));
  }

  async function handleExport() {
    setExportError(null);
    setExportResult(null);

    const savePath = await pickExportSavePath("synkcut_poc_9x16");
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

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      {/* Hidden video decoder source for local footage */}
      {footagePath && (
        <video
          ref={videoRef}
          src={toAssetUrl(footagePath)}
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          className="hidden"
          onLoadedData={() => setCurrentTimeMs((t) => t)}
        />
      )}

      {/* Top Studio Header */}
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b px-4"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md font-extrabold text-sm"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)" }}
            >
              S
            </div>
            <span className="text-base font-bold tracking-tight">Synkcut</span>
          </div>
          <span
            className="rounded px-2 py-0.5 text-[11px] font-semibold font-mono-num"
            style={{
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            M0 PoC · Engine
          </span>
          <span className="hidden text-xs md:inline" style={{ color: "var(--text-muted)" }}>
            {project.meta.name}
          </span>
        </div>

        {/* Live Engine Telemetry Pills */}
        <div className="flex items-center gap-2">
          <div
            className="hidden items-center gap-1.5 rounded-md px-2.5 py-1 text-xs lg:flex"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <Cpu className="h-3.5 w-3.5" style={{ color: webCodecs.avcSupported ? "var(--role-cta)" : "var(--role-hook)" }} />
            <span>WebCodecs H.264: {webCodecs.avcSupported ? "Siap" : "Cek"}</span>
          </div>

          <div
            className="hidden items-center gap-1.5 rounded-md px-2.5 py-1 text-xs lg:flex"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
            title={sidecarStatus?.ffmpegVersion || ""}
          >
            <ShieldCheck
              className="h-3.5 w-3.5"
              style={{ color: sidecarStatus?.ffmpegReady ? "var(--role-cta)" : "var(--text-muted)" }}
            />
            <span>
              FFmpeg:{" "}
              {sidecarStatus?.ffmpegReady
                ? sidecarStatus.isLgpl
                  ? "LGPL Siap"
                  : "Siap"
                : isTauriRuntime()
                  ? "Belum Ada"
                  : "Mode Web"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-pointer"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            }}
            title={theme === "dark" ? "Ganti ke Light Studio" : "Ganti ke Dark Studio"}
            aria-label="Ganti tema Dark atau Light Studio"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold transition-opacity disabled:opacity-50 cursor-pointer"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-fg)",
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {isExporting ? `Exporting ${Math.round(exportPct)}%` : "Export MP4 Lokal"}
          </button>
        </div>
      </header>

      {/* Main 3-Column Studio Workspace */}
      <main className="grid min-h-0 flex-1 grid-cols-12">
        {/* LEFT COLUMN: Local Assets + Scene Cards (0-Token Micro-Edit) */}
        <section
          className="col-span-4 flex min-h-0 flex-col border-r"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {/* Local Footage & Audio Controls */}
          <div className="border-b p-4" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Bahan Lokal
              </h2>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                100% di komputer lo
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handlePickFootage}
                className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                {footagePath ? "Ganti Footage" : "Pilih Footage MP4"}
              </button>

              <button
                type="button"
                onClick={handlePickAudio}
                disabled={!isTauriRuntime()}
                className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50 cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
                title={isTauriRuntime() ? "Pilih audio/voiceover lokal" : "Aktif di aplikasi desktop Tauri"}
              >
                <Music className="h-3.5 w-3.5" />
                {audioPath ? "Ganti Audio" : "Pilih Audio Lokal"}
              </button>
            </div>

            {/* Disabled Coming Soon: Google Flow / Seedance */}
            <div
              className="mt-2 flex items-center justify-between rounded-md px-3 py-2 text-xs opacity-65"
              style={{
                backgroundColor: "var(--bg-elevated)",
                border: "1px dashed var(--border-strong)",
              }}
            >
              <div className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
                <span style={{ color: "var(--text-secondary)" }}>AI Footage (Google Flow / Seedance)</span>
              </div>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: "var(--bg-panel)", color: "var(--text-muted)" }}
              >
                Coming Soon
              </span>
            </div>

            {/* Probed Metadata + Multimodal Thumbnails */}
            {footageProbe && (
              <div
                className="mt-3 rounded-md p-2.5 text-[11px]"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="flex items-center justify-between font-mono-num">
                  <span className="font-semibold">
                    {footageProbe.width}×{footageProbe.height} · {footageProbe.fps}fps
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {formatTimecode(footageProbe.durationMs)} · {footageProbe.videoCodec}
                  </span>
                </div>
                {footageThumbs.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {footageThumbs.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`Thumbnail ${i + 1}`}
                        className="h-14 w-24 rounded object-cover"
                        style={{ border: "1px solid var(--border-subtle)" }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scene Storyboard Cards */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  Scene Cards
                </h2>
              </div>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Edit mikro = 0 token AI
              </span>
            </div>

            <div className="space-y-3">
              {project.scenes.map((scene, index) => {
                const isActive = currentTimeMs >= scene.startMs && currentTimeMs < scene.endMs;
                return (
                  <div
                    key={scene.id}
                    onClick={() => setCurrentTimeMs(scene.startMs)}
                    className="rounded-lg p-3 transition-colors cursor-pointer"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: isActive
                        ? `1px solid ${roleColor(scene.role)}`
                        : "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: roleColor(scene.role) }}
                        />
                        <span className="text-xs font-bold uppercase tracking-wide">
                          {index + 1}. {scene.role}
                        </span>
                      </div>
                      <span className="font-mono-num text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {formatTimecode(scene.startMs)} – {formatTimecode(scene.endMs)}
                      </span>
                    </div>

                    <textarea
                      value={scene.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleSceneTextChange(scene.id, e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-md p-2 text-xs leading-relaxed outline-none"
                      style={{
                        backgroundColor: "var(--bg-panel)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    />

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Motion:
                      </span>
                      <select
                        value={scene.motion.preset}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          handleSceneMotionChange(scene.id, e.target.value as MotionPreset)
                        }
                        className="rounded px-2 py-1 text-[11px] font-medium outline-none"
                        style={{
                          backgroundColor: "var(--bg-panel)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-primary)",
                        }}
                      >
                        {MOTION_PRESETS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CENTER COLUMN: Live 9:16 Canvas Preview */}
        <section
          className="col-span-5 flex min-h-0 flex-col items-center justify-between p-4"
          style={{ backgroundColor: "var(--bg-canvas-well)" }}
        >
          {/* Preview Toolbar */}
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <Film className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
              <span className="text-xs font-semibold">Live Preview · 9:16</span>
            </div>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={showSafeZone}
                onChange={(e) => setShowSafeZone(e.target.checked)}
                className="accent-current"
              />
              Safe Zone TikTok/Reels
            </label>
          </div>

          {/* 9:16 Canvas Viewport */}
          <div className="flex min-h-0 flex-1 items-center justify-center py-3">
            <canvas
              ref={canvasRef}
              width={1080}
              height={1920}
              className="max-h-full w-auto rounded-xl shadow-2xl"
              style={{
                aspectRatio: "9 / 16",
                border: "1px solid var(--border-strong)",
                backgroundColor: "#000000",
              }}
            />
          </div>

          {/* Playback Scrubber Bar */}
          <div
            className="w-full rounded-lg p-3"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md cursor-pointer"
                style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)" }}
                aria-label={isPlaying ? "Pause preview" : "Play preview"}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setCurrentTimeMs(0);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
                title="Ulang dari 00:00"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>

              <input
                type="range"
                min={0}
                max={totalDurationMs}
                step={33}
                value={Math.min(currentTimeMs, totalDurationMs)}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentTimeMs(Number(e.target.value));
                }}
                className="flex-1 cursor-pointer"
              />

              <span className="font-mono-num text-xs" style={{ color: "var(--text-secondary)" }}>
                {formatTimecode(currentTimeMs)} / {formatTimecode(totalDurationMs)}
              </span>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Preset Switcher + Export Pipeline & Telemetry */}
        <section
          className="col-span-3 flex min-h-0 flex-col border-l"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
            {/* Caption Preset Quick Switch */}
            <div>
              <div className="mb-2.5 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  Style Caption (Klik Langsung)
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {CAPTION_PRESETS.map((preset) => {
                  const active = project.globalStyle.captionPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setProject((prev) => ({
                          ...prev,
                          globalStyle: { ...prev.globalStyle, captionPreset: preset.id },
                        }))
                      }
                      className="flex items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                        border: active
                          ? "1px solid var(--accent)"
                          : "1px solid var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <span>{preset.label}</span>
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

            {/* Export Settings */}
            <div className="border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
              <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Pengaturan Export MP4
              </h2>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Resolusi
                  </label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as "1080p" | "720p")}
                    className="w-full rounded-md px-2.5 py-1.5 text-xs font-medium outline-none"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value="1080p">1080×1920 (Full HD)</option>
                    <option value="720p">720×1280 (Draft Cepat)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Frame Rate
                  </label>
                  <select
                    value={exportFps}
                    onChange={(e) => setExportFps(Number(e.target.value) as 30 | 60)}
                    className="w-full rounded-md px-2.5 py-1.5 text-xs font-medium outline-none"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value={30}>30 FPS</option>
                    <option value={60}>60 FPS</option>
                  </select>
                </div>
              </div>

              {!audioPath && (
                <label className="mt-3 flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={generateDemoAudio}
                    onChange={(e) => setGenerateDemoAudio(e.target.checked)}
                  />
                  Sertakan audio demo (tes FFmpeg mux)
                </label>
              )}

              {/* Export Progress Box */}
              {(isExporting || exportMessage) && (
                <div
                  className="mt-3 rounded-lg p-3"
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
                  className="mt-3 rounded-lg p-3 text-xs"
                  style={{
                    backgroundColor: "rgba(220, 38, 38, 0.12)",
                    border: "1px solid var(--danger)",
                    color: "var(--danger)",
                  }}
                >
                  {exportError}
                </div>
              )}

              {exportResult && (
                <div
                  className="mt-3 rounded-lg p-3 text-xs"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--role-cta)",
                  }}
                >
                  <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--role-cta)" }}>
                    <CheckCircle2 className="h-4 w-4" />
                    MP4 Lokal Siap Diputar
                  </div>
                  <p className="mt-1 break-all font-mono-num text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {exportResult.outputPath}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <span>{formatBytes(exportResult.fileSizeBytes)}</span>
                    <span>{formatTimecode(exportResult.durationMs)}</span>
                  </div>
                  {isTauriRuntime() && (
                    <button
                      type="button"
                      onClick={() => revealInExplorer(exportResult.outputPath)}
                      className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                      style={{
                        backgroundColor: "var(--bg-panel)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Buka di Folder
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Collapsible JSON Scene Graph Inspector */}
            <div className="border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
              <button
                type="button"
                onClick={() => setShowJson((v) => !v)}
                className="flex w-full items-center justify-between text-xs font-semibold cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                <span>Inspeksi project.synk.json</span>
                <span className="font-mono-num text-[11px]">{showJson ? "Sembunyikan" : "Lihat"}</span>
              </button>
              {showJson && (
                <pre
                  className="mt-2 max-h-56 overflow-auto rounded-md p-2.5 font-mono-num text-[10px] leading-relaxed"
                  style={{
                    backgroundColor: "var(--bg-canvas-well)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {JSON.stringify(project, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
